/**
 * WhatsApp Status Bot (Dedicado, Ultraleve & Otimizado)
 * 
 * Funcionalidades:
 * - Visualizador e Curtidor Automático de Status (Stories)
 * - Modos: Só Visualizar, Só Curtir (mantém círculo verde), Ambos e Desligado
 * - Isolamento Total: Ignora 100% de terceiros e grupos, responde apenas a comandos 'fromMe'
 * - Cache LRU em memória para evitar gargalos de I/O de disco
 * - Backoff exponencial e reconexão segura
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  proto
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

// Silencia logs internos verbosos do libsignal (dumps de chaves e ratchets que sobrecarregam CPU e disco)
const origConsoleInfo = console.info;
console.info = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Closing session') ||
    args[0].startsWith('Opening session') ||
    args[0].startsWith('Session already') ||
    args[0].startsWith('Removing old closed session') ||
    args[0].startsWith('Migrating session')
  )) {
    return;
  }
  origConsoleInfo(...args);
};

const origConsoleWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Closing open session') ||
    args[0].startsWith('Decrypted message with closed session') ||
    args[0].startsWith('Session already')
  )) {
    return;
  }
  origConsoleWarn(...args);
};

const origConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Failed to decrypt message') ||
    args[0].startsWith('Session error:Error: Bad MAC')
  )) {
    return;
  }
  origConsoleError(...args);
};

const configPath = path.resolve('./config.json');
const statsPath = path.resolve('./stats.json');

function loadConfig() {
  const defaults = {
    mode: 'both', // 'view' | 'like' | 'both' | 'off'
    emoji: '❤️',
    phoneNumber: '5574998000519',
    typingChats: {}
  };
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!parsed.typingChats) parsed.typingChats = {};
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

let config = loadConfig();
let saveConfigTimer = null;
function saveConfig() {
  if (saveConfigTimer) return;
  saveConfigTimer = setTimeout(() => {
    fs.writeFile(configPath, JSON.stringify(config, null, 2), () => {});
    saveConfigTimer = null;
  }, 1000);
}

const PRESENCE_INTERVAL_MS = 10000;
let presenceInterval = null;

function iniciarPresenceLoop(sock) {
  if (presenceInterval) clearInterval(presenceInterval);
  if (!sock) return;

  const tick = async () => {
    if (!activeSock || !config.typingChats) return;
    const entries = Object.entries(config.typingChats);
    for (const [jid, info] of entries) {
      const mode = (typeof info === 'object' ? info?.mode : info) || 'composing';
      try {
        await activeSock.sendPresenceUpdate(mode, jid);
      } catch (e) {}
    }
  };

  tick().catch(() => {});
  presenceInterval = setInterval(tick, PRESENCE_INTERVAL_MS);
}

function loadStats() {
  const defaults = { viewed: 0, liked: 0, totalViewsReceived: 0, viewsReceived: {} };
  try {
    if (fs.existsSync(statsPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(statsPath, 'utf8')) };
    }
  } catch {}
  return defaults;
}

let stats = loadStats();
let saveStatsTimer = null;
function saveStats() {
  if (saveStatsTimer) return;
  saveStatsTimer = setTimeout(() => {
    fs.writeFile(statsPath, JSON.stringify(stats, null, 2), () => {});
    saveStatsTimer = null;
  }, 2000);
}

/**
 * Wrapper com Cache LRU em memória para useMultiFileAuthState
 * Elimina milhares de leituras lentas em disco na Oracle Cloud
 */
async function useCachedAuthState(sessionDir) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const cache = new Map();
  const MAX_CACHE = 2000;

  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const val = cache.get(key);
    cache.delete(key);
    cache.set(key, val);
    return val;
  }

  function cacheSet(key, val) {
    if (cache.has(key)) cache.delete(key);
    else if (cache.size >= MAX_CACHE) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    cache.set(key, val);
  }

  const origGet = state.keys.get;
  const origSet = state.keys.set;

  state.keys.get = async (type, ids) => {
    const result = {};
    const missing = [];

    for (const id of ids) {
      const key = `${type}:${id}`;
      const cached = cacheGet(key);
      if (cached !== undefined) {
        if (cached !== null) result[id] = cached;
      } else {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const loaded = await origGet(type, missing);
      for (const id of missing) {
        const val = loaded[id] ?? null;
        cacheSet(`${type}:${id}`, val);
        if (val !== null) result[id] = val;
      }
    }

    return result;
  };

  state.keys.set = async (data) => {
    for (const type in data) {
      for (const id in data[type]) {
        const val = data[type][id];
        cacheSet(`${type}:${id}`, val ?? null);
      }
    }
    return origSet(data);
  };

  return { state, saveCreds };
}

// Cache leve de mensagens para retries (máx 500 mensagens)
const msgRetryCache = new Map();
const MAX_RETRY_CACHE = 500;
function cacheMessage(m) {
  if (m?.key?.id && m?.message) {
    if (msgRetryCache.size >= MAX_RETRY_CACHE) {
      const oldestKey = msgRetryCache.keys().next().value;
      msgRetryCache.delete(oldestKey);
    }
    msgRetryCache.set(m.key.id, m.message);
  }
}

// Deduplicação de status para evitar curtir/contar o mesmo status mais de uma vez
const processedStatusIds = new Set();
const MAX_PROCESSED_STATUS = 3000;
function isStatusAlreadyProcessed(statusId) {
  if (!statusId) return false;
  if (processedStatusIds.has(statusId)) return true;
  if (processedStatusIds.size >= MAX_PROCESSED_STATUS) {
    const oldest = processedStatusIds.values().next().value;
    processedStatusIds.delete(oldest);
  }
  processedStatusIds.add(statusId);
  return false;
}

let activeSock = null;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_BACKOFF_MS = 30000;

async function startBot() {
  config = loadConfig();
  stats = loadStats();

  // Limpa socket e listeners anteriores para evitar conexões zumbis
  if (activeSock) {
    try {
      activeSock.ev.removeAllListeners();
      activeSock.ws?.close();
    } catch {}
    activeSock = null;
  }

  const { state, saveCreds } = await useCachedAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'warn' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    shouldSyncHistoryMessage: (msg) => {
      // Sincroniza apenas mapeamento de LIDs e contatos essenciais (evita loop de notificação no celular)
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
  sock.ev.on('creds.update', saveCreds);

  // Descarta mensagens antigas de sincronização de histórico silenciosamente
  sock.ev.on('messaging-history.set', () => {});

  // Captura recibos de leitura (visualizações de status@broadcast)
  sock.ev.on('message-receipt.update', async (receipts) => {
    if (!Array.isArray(receipts)) return;
    for (const item of receipts) {
      if (item.key?.remoteJid === 'status@broadcast') {
        const statusId = item.key.id;
        const viewer = item.receipt?.userJid;
        const isRead = !!item.receipt?.readTimestamp;

        if (isRead && viewer) {
          if (!stats.viewsReceived) stats.viewsReceived = {};
          if (!stats.viewsReceived[statusId]) stats.viewsReceived[statusId] = [];

          if (!stats.viewsReceived[statusId].includes(viewer)) {
            stats.viewsReceived[statusId].push(viewer);
            stats.totalViewsReceived = (stats.totalViewsReceived || 0) + 1;
            saveStats();
            const viewerNum = viewer.split('@')[0];
            console.log(`[STATUS] Status visualizado por +${viewerNum} (Total recebidas: ${stats.totalViewsReceived})`);
          }
        }
      }
    }
  });

  // Captura atualizações de mensagens para status@broadcast (ex: recibos em lote)
  sock.ev.on('messages.update', async (updates) => {
    if (!Array.isArray(updates)) return;
    for (const item of updates) {
      if (item.key?.remoteJid === 'status@broadcast') {
        const statusId = item.key.id;
        const userReceipts = item.update?.userReceipt;
        if (Array.isArray(userReceipts)) {
          if (!stats.viewsReceived) stats.viewsReceived = {};
          if (!stats.viewsReceived[statusId]) stats.viewsReceived[statusId] = [];

          let changed = false;
          for (const ur of userReceipts) {
            if (ur.userJid && ur.readTimestamp && !stats.viewsReceived[statusId].includes(ur.userJid)) {
              stats.viewsReceived[statusId].push(ur.userJid);
              stats.totalViewsReceived = (stats.totalViewsReceived || 0) + 1;
              changed = true;
            }
          }
          if (changed) {
            saveStats();
            console.log(`[STATUS] Visualizações de status atualizadas (Total: ${stats.totalViewsReceived})`);
          }
        }
      }
    }
  });

  // Monitorar status da conexão
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Se receber QR Code e ainda não estiver pareado
    if (qr && !state.creds.registered) {
      console.log('\n======================================================');
      console.log('  📱 ESCANEIE O QR CODE COM SEU WHATSAPP:');
      console.log('======================================================');
      qrcode.generate(qr, { small: true });
      fs.writeFile('./qr.txt', qr, () => {});
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        if (!isReconnecting) {
          isReconnecting = true;
          reconnectAttempts++;
          const delay = Math.min(2500 * Math.pow(1.4, reconnectAttempts - 1), MAX_BACKOFF_MS);
          console.log(`[CONEXÃO] Fechada (${statusCode}). Reconectando em ${Math.round(delay/1000)}s (tentativa ${reconnectAttempts})...`);
          setTimeout(() => {
            isReconnecting = false;
            startBot();
          }, delay);
        }
      } else {
        console.log('[CONEXÃO] Sessão desconectada/revogada pelo usuário no celular.');
        process.exit(0);
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('\n====================================================');
      console.log('  ✅ STATUS BOT CONECTADO COM SUCESSO!');
      console.log(`  ⚙️ Modo Ativo: ${config.mode.toUpperCase()} (Emoji: ${config.emoji})`);
      console.log('====================================================\n');
      if (fs.existsSync('./qr.txt')) {
        try { fs.unlinkSync('./qr.txt'); } catch {}
      }
      iniciarPresenceLoop(sock);
    }
  });

  // Processar Mensagens
  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || messages.length === 0) return;

    for (const m of messages) {
      if (!m.message) continue;
      cacheMessage(m);

      const remoteJid = m.key.remoteJid;
      const participant = m.key.participant || m.participant;

      // 1. PROCESSAR STATUS (STORIES) - Execução Imediata
      if (remoteJid === 'status@broadcast') {
        if (m.key.fromMe || !participant) continue;
        if (config.mode === 'off') continue;
        if (isStatusAlreadyProcessed(m.key.id)) continue;

        (async () => {
          try {
            const statusKey = {
              remoteJid: 'status@broadcast',
              id: m.key.id,
              participant: participant
            };
            const sender = participant.split('@')[0] || 'Contato';

            // Modo Visualizar ou Ambos -> marca como lido
            if (config.mode === 'view' || config.mode === 'both') {
              await sock.readMessages([statusKey]);
              stats.viewed = (stats.viewed || 0) + 1;
              saveStats();
              console.log(`[STATUS] Visualizado de +${sender} (Total: ${stats.viewed})`);
            }

            // Modo Curtir ou Ambos -> reage no status
            if (config.mode === 'like' || config.mode === 'both') {
              await sock.sendMessage('status@broadcast', {
                react: {
                  text: config.emoji || '❤️',
                  key: statusKey
                }
              }, {
                statusJidList: [participant]
              });
              stats.liked = (stats.liked || 0) + 1;
              saveStats();
              console.log(`[STATUS] Curtido com ${config.emoji || '❤️'} de +${sender}${config.mode === 'like' ? ' (Círculo verde mantido)' : ''} (Total: ${stats.liked})`);
            }
          } catch (err) {
            console.error('[STATUS ERRO]', err.message);
          }
        })();
        continue;
      }

      // 2. Permissões: Aceita mensagens enviadas pela própria conta (fromMe) ou pelo dono cadastrado
      const senderNum = (participant || remoteJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const ownerNum = (config.phoneNumber || '').replace(/\D/g, '');
      const isOwnerPhone = ownerNum && (senderNum === ownerNum || senderNum.endsWith(ownerNum.slice(4)) || ownerNum.endsWith(senderNum.slice(4)));
      const isFromOwner = m.key.fromMe || isOwnerPhone;

      if (!isFromOwner) continue;

      // Extrai texto da mensagem enviada pelo próprio dono
      const fullText = (
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        m.message.videoMessage?.caption ||
        ''
      ).trim();

      if (!fullText) continue;

      const prefix = '.';
      if (!fullText.startsWith(prefix)) continue;

      const clean = fullText.slice(prefix.length).trim();
      const parts = clean.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      // Comandos de Controle (Prefixo exclusivo '.' e sem abreviações)
      if (cmd === 'visualizar') {
        config.mode = 'view';
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: '👁️ *Status Bot:* Modo *Apenas Visualizar* ATIVADO ✅\n(Status serão marcados como vistos sem enviar nenhuma reação/curtida)'
        }, { quoted: m });
      }
      else if (cmd === 'curtir') {
        config.mode = 'like';
        if (args[0] && args[0].length <= 4) config.emoji = args[0];
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: `❤️ *Status Bot:* Modo *Apenas Curtir* ATIVADO ✅ (Emoji: ${config.emoji || '❤️'})\n🟢 *Círculo Verde Preservado:* O bot reage aos status SEM marcar como lido, continuando como não visto no celular.`
        }, { quoted: m });
      }
      else if (cmd === 'ambos') {
        config.mode = 'both';
        if (args[0] && args[0].length <= 4) config.emoji = args[0];
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: `✨ *Status Bot:* Modo *Ambos* ATIVADO ✅ (Visualizar e Curtir)\n(Status serão visualizados e curtidos com ${config.emoji || '❤️'} imediatamente)`
        }, { quoted: m });
      }
      else if (cmd === 'desligar') {
        config.mode = 'off';
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: '❌ *Status Bot:* DESLIGADO\n(Não visualiza e nem curte status)'
        }, { quoted: m });
      }
      else if (['restart', 'reiniciar', 'reboot'].includes(cmd)) {
        await sock.sendMessage(remoteJid, {
          text: '🔄 *Reiniciando o Status Bot...*\n\nAguarde cerca de 5 segundos para a reconexão automática.'
        }, { quoted: m });

        setTimeout(() => {
          process.exit(0);
        }, 1500);
      }
      else if (cmd === 'emoji') {
        if (args[0]) {
          config.emoji = args[0];
          saveConfig();
          await sock.sendMessage(remoteJid, {
            text: `🎨 *Emoji de Reação Atualizado:* ${config.emoji}`
          }, { quoted: m });
        }
      }
      else if (cmd === 'status' || cmd === 'menu' || cmd === 'ajuda') {
        const modoDesc = config.mode === 'both'
          ? `Ambos (Ver e Curtir) ✨ (${config.emoji || '❤️'})`
          : config.mode === 'like'
          ? `Apenas Curtir 🟢 (${config.emoji || '❤️'}) (Círculo Verde Preservado)`
          : config.mode === 'view'
          ? 'Apenas Visualizar 👁️'
          : 'Desligado ❌';

        const uptimeSeconds = Math.floor(process.uptime());
        const h = Math.floor(uptimeSeconds / 3600);
        const min = Math.floor((uptimeSeconds % 3600) / 60);
        const s = uptimeSeconds % 60;
        const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

        const msg = `⚡ *STATUS BOT PESSOAL* ⚡\n\n` +
          `⚙️ *Modo Atual:* ${modoDesc}\n` +
          `👁️ *Total Visualizados:* ${stats.viewed || 0}\n` +
          `👀 *Views Recebidas (Status):* ${stats.totalViewsReceived || 0}\n` +
          `❤️ *Total Curtidos:* ${stats.liked || 0}\n` +
          `⌨️ *Presença Fake:* ${Object.keys(config.typingChats || {}).length} chat(s) ativo(s)\n` +
          `💾 *RAM:* ${ramMB} MB\n` +
          `⏱️ *Tempo Ativo:* ${h}h ${min}m ${s}s\n\n` +
          `*Comandos (Prefixo: \`.\` ou \`!\`):*\n` +
          `• \`.digita\` / \`.grava\` / \`.online\` - Presença fake (mesmo comando liga/desliga)\n` +
          `• \`.parar\` - Para presença fake no chat atual\n` +
          `• \`.reset\` - Reseta presença fake em todos os chats\n` +
          `• \`.restart\` - Reinicia o bot caso esteja travado\n` +
          `• \`.visualizar\` - Só marca como lido\n` +
          `• \`.curtir\` [emoji] - Só curte (mantém círculo verde)\n` +
          `• \`.ambos\` [emoji] - Visualiza e curte juntos\n` +
          `• \`.desligar\` - Desativa a função\n` +
          `• \`.emoji <emoji>\` - Troca o emoji de curtida\n` +
          `• \`.status\` - Mostra este painel`;

        await sock.sendMessage(remoteJid, { text: msg }, { quoted: m });
      }
      else if (['digita', 'digitando', 'typing', 'grava', 'gravando', 'audio', 'áudio', 'rec', 'online', 'disp', 'presenca', 'presença', 'parar', 'stop', 'reset', 'resetar', 'desativardigita', 'limpardigita'].includes(cmd)) {
        if (!config.typingChats) config.typingChats = {};

        const subcmd = (args[0] || '').toLowerCase();
        const extra = (args[1] || '').toLowerCase();

        const getChatDisplayName = async (jid) => {
          let name = '';
          if (jid.endsWith('@g.us')) {
            try {
              const meta = await sock.groupMetadata(jid);
              name = meta.subject;
            } catch {
              name = 'Grupo';
            }
          } else {
            name = `+${jid.split('@')[0]}`;
          }
          return name;
        };

        // 1. Desativar de TODOS os chats de uma vez (!reset, .reset, !resetar, .digita reset, .digita off all)
        const isResetAll = ['reset', 'resetar', 'desativardigita', 'limpardigita'].includes(cmd) ||
                           (['off', '0', 'desativar', 'parar', 'stop', 'reset', 'limpar'].includes(subcmd) && ['all', 'todos', 'tudo'].includes(extra)) ||
                           (['off', '0', 'desativar', 'parar', 'stop', 'reset', 'limpar'].includes(cmd) && ['all', 'todos', 'tudo'].includes(subcmd)) ||
                           ['reset', 'resetar', 'limpar', 'limpartudo', 'desativartudo'].includes(subcmd) ||
                           (subcmd === 'all' || subcmd === 'todos');

        if (isResetAll) {
          const activeJids = Object.keys(config.typingChats);
          const count = activeJids.length;

          for (const jid of activeJids) {
            try {
              await sock.sendPresenceUpdate('paused', jid);
            } catch {}
          }

          config.typingChats = {};
          saveConfig();

          await sock.sendMessage(remoteJid, {
            text: `🧹 *Presença Fake Resetada em Todos os Chats!*\n\nForam limpos e pausados *${count}* chat(s).\nSua conta agora está em estado normal em todas as conversas.`
          }, { quoted: m });
          return;
        }

        // 2. Listar onde a presença fake está ativa
        if (['lista', 'list', 'status', 'chats', 'ativos', 'onde'].includes(subcmd)) {
          const activeJids = Object.keys(config.typingChats);

          if (activeJids.length === 0) {
            await sock.sendMessage(remoteJid, {
              text: 'ℹ️ *Nenhum chat com presença fake ativa no momento.*'
            }, { quoted: m });
            return;
          }

          let listText = `📋 *CHATS COM PRESENÇA FAKE ATIVA (${activeJids.length})*\n\n`;
          for (let i = 0; i < activeJids.length; i++) {
            const jid = activeJids[i];
            const info = config.typingChats[jid];
            const mode = (typeof info === 'object' ? info?.mode : info) || 'composing';
            let name = (typeof info === 'object' && info?.name) ? info.name : '';

            if (!name) {
              name = await getChatDisplayName(jid);
              if (typeof config.typingChats[jid] === 'object') {
                config.typingChats[jid].name = name;
              }
            }

            const modeDesc = mode === 'recording'
              ? '🎙️ Gravando áudio...'
              : mode === 'available'
              ? '🟢 Online'
              : '⌨️ Digitando...';

            listText += `${i + 1}. *${name}*\n   • Modo: ${modeDesc}\n   • Tipo: ${jid.endsWith('@g.us') ? '👥 Grupo' : '👤 Privado'}\n   • JID: \`${jid}\`\n\n`;
          }

          saveConfig();
          await sock.sendMessage(remoteJid, { text: listText.trim() }, { quoted: m });
          return;
        }

        // 3. Desativar explicitamente no chat atual (!parar, .parar, !stop, .stop, .digita parar, .digita off)
        const isExplicitOff = ['parar', 'stop'].includes(cmd) ||
                              ['off', '0', 'desativar', 'parar', 'stop', 'nao', 'não', 'false'].includes(subcmd);

        if (isExplicitOff) {
          if (config.typingChats[remoteJid]) {
            delete config.typingChats[remoteJid];
            saveConfig();
            try {
              await sock.sendPresenceUpdate('paused', remoteJid);
            } catch {}
            await sock.sendMessage(remoteJid, {
              text: '⏹️ *Presença Fake Parada:* Desativada com sucesso neste chat.'
            }, { quoted: m });
          } else {
            await sock.sendMessage(remoteJid, {
              text: 'ℹ️ A presença fake já não estava ativa neste chat.'
            }, { quoted: m });
          }
          return;
        }

        // 4. Determinar o modo alvo (Toggle: o mesmo comando liga e desliga)
        let targetMode = 'composing';
        if (['grava', 'gravando', 'audio', 'áudio', 'rec'].includes(cmd) || ['grava', 'gravando', 'audio', 'áudio', 'rec', 'voz'].includes(subcmd)) {
          targetMode = 'recording';
        } else if (['online', 'disp'].includes(cmd) || ['online', 'disp', 'disponivel', 'disponível', 'available'].includes(subcmd)) {
          targetMode = 'available';
        } else {
          targetMode = 'composing';
        }

        const current = config.typingChats[remoteJid];
        const currentMode = typeof current === 'object' ? current?.mode : current;

        // Se já está ativo NO MESMO MODO -> DESLIGA (Toggle OFF)
        if (current && currentMode === targetMode) {
          delete config.typingChats[remoteJid];
          saveConfig();
          try {
            await sock.sendPresenceUpdate('paused', remoteJid);
          } catch {}

          const label = targetMode === 'recording'
            ? '🎙️ *Gravando áudio...*'
            : targetMode === 'available'
            ? '🟢 *Online*'
            : '⌨️ *Digitando...*';

          await sock.sendMessage(remoteJid, {
            text: `⏹️ ${label} *DESATIVADO* neste chat.`
          }, { quoted: m });
          return;
        }

        // Se não está ativo ou estava em outro modo -> LIGA (Toggle ON)
        const chatName = await getChatDisplayName(remoteJid);
        config.typingChats[remoteJid] = {
          mode: targetMode,
          name: chatName,
          updatedAt: Date.now()
        };
        saveConfig();
        try {
          await sock.sendPresenceUpdate(targetMode, remoteJid);
        } catch {}

        const label = targetMode === 'recording'
          ? '🎙️ *Gravando áudio...*'
          : targetMode === 'available'
          ? '🟢 *Online*'
          : '⌨️ *Digitando...*';

        const toggleCmd = targetMode === 'recording'
          ? `${prefix}grava`
          : targetMode === 'available'
          ? `${prefix}online`
          : `${prefix}digita`;

        await sock.sendMessage(remoteJid, {
          text: `✅ ${label} *ATIVADO* neste chat!`
        }, { quoted: m });
      }
    }
  });
}

startBot();
