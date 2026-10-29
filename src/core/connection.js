/**
 * Gerenciador Unificado de Conexão com o WhatsApp (Baileys)
 * - Inicialização padronizada com validação de versão e credenciais
 * - Suporte a QR Code e Código de Pareamento (Pairing Code)
 * - Cache de retentativas de mensagens para evitar erros de descriptografia
 * - Reconexão automática com backoff exponencial seguro
 * - Fechamento e limpeza de sockets anteriores para evitar zumbis de memória
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  proto
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
    onOpen,
    onClose,
    onMessage,
    onReceipt,
    onMessagesUpdate,
    onGroupParticipantsUpdate
  } = options;

  let activeSock = null;
  let isReconnecting = false;
  let reconnectAttempts = 0;
  const MAX_BACKOFF_MS = 30000;

  // Cache LRU em memória para retry de mensagens (máx 500)
  const msgRetryCache = new Map();
  const MAX_RETRY_CACHE = 500;

  function cacheMessage(m) {
    if (m?.key?.id && m?.message) {
      if (msgRetryCache.size >= MAX_RETRY_CACHE) {
        const oldest = msgRetryCache.keys().next().value;
        msgRetryCache.delete(oldest);
      }
      msgRetryCache.set(m.key.id, m.message);
    }
  }

  async function connect() {
    // 1. Limpeza total de socket anterior
    if (activeSock) {
      try {
        activeSock.ev.removeAllListeners();
        activeSock.ws?.close();
      } catch {}
      activeSock = null;
    }

    const resolvedSession = path.resolve(sessionDir);
    const { state, saveCreds } = await useCachedAuthState(resolvedSession);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info('BAILEYS', `Inicializando v${version.join('.')} (Última: ${isLatest ? 'Sim' : 'Não'})`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      shouldSyncHistoryMessage: (msg) => {
        return msg.syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP ||
               msg.syncType === proto.HistorySync.HistorySyncType.PUSH_NAME;
      },
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      getMessage: async (key) => msgRetryCache.get(key.id) || undefined,
      shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') || false
    });

    activeSock = sock;

    // Salvar credenciais sempre que atualizadas
    sock.ev.on('creds.update', saveCreds);

    // Silenciar mensagens de sincronização de histórico silenciosamente
    sock.ev.on('messaging-history.set', () => {});

    // Monitoramento da Conexão
    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // 1. Autenticação via QR Code ou Código de Pareamento
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

      // 2. Conexão Fechada / Desconectada
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn('CONEXÃO', `Conexão fechada (${statusCode || 'desconhecido'}). Reconectar: ${shouldReconnect ? 'Sim' : 'Não'}`);

        if (onClose) onClose(statusCode, shouldReconnect);

        if (shouldReconnect) {
          if (!isReconnecting) {
            isReconnecting = true;
            reconnectAttempts++;
            const delay = Math.min(2500 * Math.pow(1.4, reconnectAttempts - 1), MAX_BACKOFF_MS);
            logger.info('CONEXÃO', `Reconectando em ${Math.round(delay / 1000)}s (tentativa ${reconnectAttempts})...`);
            setTimeout(() => {
              isReconnecting = false;
              connect();
            }, delay);
          }
        } else {
          logger.error('CONEXÃO', 'Sessão revogada ou desconectada no celular. Encerrando processo.');
          process.exit(0);
        }
      }

      // 3. Conexão Aberta com Sucesso
      else if (connection === 'open') {
        reconnectAttempts = 0;
        cleanAuthArtifacts();

        logger.success('CONEXÃO', '✅ WhatsApp conectado com sucesso!');
        if (onOpen) onOpen(sock);
      }
    });

    // Eventos de Recibos de Leitura (Status Views)
    if (onReceipt) {
      sock.ev.on('message-receipt.update', (receipts) => onReceipt(receipts, sock));
    }

    // Eventos de Atualização de Mensagens (ex: status views em lote)
    if (onMessagesUpdate) {
      sock.ev.on('messages.update', (updates) => onMessagesUpdate(updates, sock));
    }

    // Eventos de Mensagens Recebidas
    if (onMessage) {
      sock.ev.on('messages.upsert', ({ messages }) => {
        if (!messages || messages.length === 0) return;
        for (const m of messages) {
          cacheMessage(m);
        }
        onMessage(messages, sock);
      });
    }

    // Eventos de Membros de Grupo (Antifake)
    if (onGroupParticipantsUpdate) {
      sock.ev.on('group-participants.update', (data) => onGroupParticipantsUpdate(data, sock));
    }

    return sock;
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
    getSocket: () => activeSock,
    cacheMessage
  };
}
