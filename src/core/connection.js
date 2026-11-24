/**
 * Gerenciador Unificado de Conexão com o WhatsApp (Baileys)
 * - Cache de versão Baileys (6h) com fallback seguro contra falhas de rede na reconexão
 * - Proteção try/catch na reconexão para evitar queda do processo
 * - Caches LRU estritos (auth, retry e metadata de grupos) com limpeza automática no close
 * - Prevenção de restart storm no PM2 em erros 401/440
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { useCachedAuthState } from './auth.js';
import { logger } from './logger.js';

export function createWhatsAppConnection(options) {
  const {
    sessionDir = './session',
    configManager,
    storeManager,
    messageStore,
    authCacheSize = 1200,
    retryCacheSize = 80,
    retryCounterSize = 120,
    groupCacheSize = 150,
    onOpen,
    onClose,
    onMessage,
    onReceipt,
    onMessagesUpdate,
    onGroupParticipantsUpdate
  } = options;

  let activeSock = null;
  let isReconnecting = false;
  let isClosing = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_BACKOFF_MS = 30000;
  const VERSION_TTL_MS = 6 * 60 * 60 * 1000;
  let cachedVersionInfo = null;
  let cachedVersionAt = 0;

  // Cache LRU limitado para retry de mensagens (ignora status@broadcast para poupar RAM)
  const msgRetryCache = new Map();

  function cacheMessage(m) {
    if (!m?.key?.id || !m?.message || m.key?.remoteJid === 'status@broadcast') return;
    if (msgRetryCache.has(m.key.id)) {
      msgRetryCache.delete(m.key.id);
    } else if (msgRetryCache.size >= retryCacheSize) {
      const oldest = msgRetryCache.keys().next().value;
      msgRetryCache.delete(oldest);
    }
    msgRetryCache.set(m.key.id, m.message);
  }

  const msgRetryCounterMap = new Map();
  const msgRetryCounterCache = {
    get: (key) => msgRetryCounterMap.get(key),
    set: (key, val) => {
      if (msgRetryCounterMap.size >= retryCounterSize) {
        const oldest = msgRetryCounterMap.keys().next().value;
        msgRetryCounterMap.delete(oldest);
      }
      msgRetryCounterMap.set(key, val);
    },
    del: (key) => msgRetryCounterMap.delete(key)
  };

  async function resolveBaileysVersion() {
    if (cachedVersionInfo && (Date.now() - cachedVersionAt < VERSION_TTL_MS)) {
      return cachedVersionInfo;
    }
    try {
      const info = await fetchLatestBaileysVersion();
      if (info?.version) {
        cachedVersionInfo = info;
        cachedVersionAt = Date.now();
        return info;
      }
    } catch (err) {
      logger.warn('BAILEYS', `Falha ao consultar versão online, usando cache/padrão: ${err.message}`);
    }
    return cachedVersionInfo || { version: undefined, isLatest: false };
  }

  function scheduleReconnect(minDelayMs = 2500) {
    if (isClosing || isReconnecting) return;
    isReconnecting = true;
    reconnectAttempts++;
    const calcDelay = Math.min(2500 * Math.pow(1.4, reconnectAttempts - 1), MAX_BACKOFF_MS);
    const delay = Math.max(minDelayMs, calcDelay);
    logger.info('CONEXÃO', `Reconectando em ${Math.round(delay / 1000)}s (tentativa ${reconnectAttempts})...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      isReconnecting = false;
      connect();
    }, delay);
  }

  async function connect() {
    if (isClosing) return null;

    if (activeSock) {
      try {
        activeSock.ev.removeAllListeners();
        activeSock.ws?.close();
      } catch {}
      activeSock = null;
    }

    try {
      const resolvedSession = path.resolve(sessionDir);
      const { state, saveCreds } = await useCachedAuthState(resolvedSession, authCacheSize);
      const { version, isLatest } = await resolveBaileysVersion();

      const versionLabel = Array.isArray(version) ? `v${version.join('.')}` : 'padrão';
      logger.info('BAILEYS', `Inicializando ${versionLabel} (Última: ${isLatest ? 'Sim' : 'Não'})`);

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 45000,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 30000,
        fireInitQueries: false,
        msgRetryCounterCache,
        getMessage: async (key) => messageStore?.getMessage(key.id)?.message || msgRetryCache.get(key.id) || undefined,
        shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') || false
      });

      activeSock = sock;

      // Cache LRU limitado de Group Metadata (TTL de 5 min)
      const groupMetadataCache = new Map();
      const GROUP_CACHE_TTL = 5 * 60 * 1000;
      const originalGroupMetadata = sock.groupMetadata.bind(sock);

      sock.groupMetadata = async (jid) => {
        const cached = groupMetadataCache.get(jid);
        if (cached && (Date.now() - cached.timestamp < GROUP_CACHE_TTL)) {
          return cached.data;
        }
        try {
          const metadata = await originalGroupMetadata(jid);
          if (groupMetadataCache.size >= groupCacheSize && !groupMetadataCache.has(jid)) {
            const oldest = groupMetadataCache.keys().next().value;
            groupMetadataCache.delete(oldest);
          }
          groupMetadataCache.set(jid, { data: metadata, timestamp: Date.now() });
          return metadata;
        } catch (err) {
          if (cached?.data) return cached.data;
          throw err;
        }
      };

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('messaging-history.set', () => {});

      let pairingCodeRequested = false;

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !state.creds.registered) {
          const cfg = configManager.get();
          const requestPairCode = Boolean(process.argv.includes('--pair-code') || cfg.usePairingCode);
          const ownerPhone = (cfg.phoneNumber || cfg.ownerPhone || '').replace(/\D/g, '');

          if (requestPairCode && ownerPhone && !pairingCodeRequested) {
            pairingCodeRequested = true;
            try {
              const code = await sock.requestPairingCode(ownerPhone);
              const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
              logger.banner('CÓDIGO DE PAREAMENTO WHATSAPP', [
                `Número Alvo: +${ownerPhone}`,
                `Código: ${logger.colors.bold}${logger.colors.yellow}${formatted}${logger.colors.reset}`,
                'Insira este código no WhatsApp do seu celular em:',
                'Aparelhos Conectados > Conectar com número de telefone'
              ]);
              fs.writeFileSync('./pairing_code.txt', formatted, 'utf8');
            } catch (err) {
              logger.warn('PAIRING', `Falha ao solicitar pairing code, exibindo QR: ${err.message}`);
              showQRCode(qr);
            }
          } else {
            showQRCode(qr);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = !isClosing && statusCode !== DisconnectReason.loggedOut;

          logger.warn('CONEXÃO', `Conexão fechada (${statusCode || 'desconhecido'}). Reconectar: ${shouldReconnect ? 'Sim' : 'Não'}`);

          if (onClose) onClose(statusCode, shouldReconnect);

          try {
            groupMetadataCache.clear();
            sock.ev.removeAllListeners();
            sock.ws?.close();
          } catch {}
          if (activeSock === sock) activeSock = null;

          if (isClosing) return;

          if (shouldReconnect) {
            const minDelay = statusCode === DisconnectReason.connectionReplaced ? 15000 : 2500;
            scheduleReconnect(minDelay);
          } else {
            logger.error('CONEXÃO', 'Sessão revogada ou desconectada no celular. Aguardando 30s antes de encerrar.');
            setTimeout(() => process.exit(1), 30000);
          }
        } else if (connection === 'open') {
          reconnectAttempts = 0;
          cleanAuthArtifacts();
          logger.success('CONEXÃO', '✅ WhatsApp conectado com sucesso!');
          if (onOpen) onOpen(sock);
        }
      });

      if (onReceipt) {
        sock.ev.on('message-receipt.update', (receipts) => onReceipt(receipts, sock));
      }

      if (onMessagesUpdate) {
        sock.ev.on('messages.update', (updates) => onMessagesUpdate(updates, sock));
      }

      if (onMessage) {
        sock.ev.on('messages.upsert', ({ messages }) => {
          if (!messages || messages.length === 0) return;
          const now = Date.now();
          for (const m of messages) {
            m.receivedAt = now;
            cacheMessage(m);
            if (messageStore && m.key?.remoteJid !== 'status@broadcast') {
              messageStore.cacheMessage(m);
            }
            if (m.key?.remoteJid !== 'status@broadcast') {
              const types = Object.keys(m.message || {}).join(',');
              const previewText = (
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                m.message?.videoMessage?.caption ||
                ''
              ).slice(0, 30);
              const textDesc = previewText ? ` text="${previewText}"` : '';
              logger.info('MSG_RECV', `id=${m.key?.id} chat=${m.key?.remoteJid} fromMe=${m.key?.fromMe} types=[${types}]${textDesc}`);
            }
          }
          onMessage(messages, sock);
        });
      }

      sock.ev.on('group-participants.update', (data) => {
        if (data?.id) groupMetadataCache.delete(data.id);
        if (onGroupParticipantsUpdate) onGroupParticipantsUpdate(data, sock);
      });

      return sock;
    } catch (err) {
      logger.error('CONEXÃO', `Erro ao inicializar socket: ${err.message}`);
      scheduleReconnect(5000);
      return null;
    }
  }

  function close() {
    isClosing = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeSock) {
      try {
        activeSock.ev.removeAllListeners();
        activeSock.ws?.close();
      } catch {}
      activeSock = null;
    }
  }

  function showQRCode(qr) {
    try {
      fs.writeFileSync('./qr.txt', qr, 'utf8');
      logger.banner('ESCANEIE O QR CODE COM O WHATSAPP', [
        '1. Abra o WhatsApp no celular',
        '2. Vá em Aparelhos Conectados > Conectar um aparelho',
        '3. Aponte a câmera para o QR Code abaixo:'
      ]);
      qrcode.generate(qr, { small: true });
    } catch {}
  }

  function cleanAuthArtifacts() {
    for (const f of ['./qr.txt', './pairing_code.txt']) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
  }

  return {
    connect,
    close,
    getSocket: () => activeSock,
    cacheMessage
  };
}
