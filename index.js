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

function loadConfig() {
  const defaults = {
    mode: 'both', // 'view' | 'like' | 'both' | 'off'
    emoji: '❤️',
    phoneNumber: '5574998000519',
    alwaysTypingChats: []
  };
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!Array.isArray(parsed.alwaysTypingChats)) parsed.alwaysTypingChats = [];
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

// Loop de Sempre Digitando (Fake Typing contínuo para chats selecionados)
let alwaysTypingInterval = null;
function startAlwaysTypingLoop(sock) {
  if (alwaysTypingInterval) clearInterval(alwaysTypingInterval);
  alwaysTypingInterval = setInterval(async () => {
    if (!sock?.ws?.isOpen) return;
    if (!Array.isArray(config.alwaysTypingChats) || config.alwaysTypingChats.length === 0) return;

    for (const jid of config.alwaysTypingChats) {
      try {
        await sock.sendPresenceUpdate('composing', jid);
      } catch {}
    }
  }, 8000);
}



/**
 * Wrapper com Cache LRU em memória para useMultiFileAuthState
 * Elimina milhares de leituras lentas em disco na Oracle Cloud
 */
async function useCachedAuthState(sessionDir) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const cache = new Map();
  const MAX_CACHE = 400;

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
const MAX_RETRY_CACHE = 50;
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
const MAX_PROCESSED_STATUS = 1000;
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
      startAlwaysTypingLoop(sock);
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

            // Modo Visualizar ou Ambos -> marca como lido (sem gravar contadores em disco)
            if (config.mode === 'view' || config.mode === 'both') {
              await sock.readMessages([statusKey]);
              console.log(`[STATUS] Visualizado de +${sender}`);
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
              console.log(`[STATUS] Curtido com ${config.emoji || '❤️'} de +${sender}${config.mode === 'like' ? ' (Círculo verde mantido)' : ''}`);
            }
          } catch (err) {
            console.error('[STATUS ERRO]', err.message);
          }
        })();
        continue;
      }

      // 2. ISOLAMENTO TOTAL: Ignora 100% de mensagens de terceiros e grupos
      if (!m.key.fromMe) continue;

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
      let clean = '';
      if (fullText.startsWith('.')) {
        clean = fullText.slice(1).trim();
      } else if (fullText.startsWith('!')) {
        clean = fullText.slice(1).trim();
      } else if (['ping', 'status', 'curtir', 'visualizar', 'ambos', 'desligar', 'menu', 'ajuda'].includes(fullText.toLowerCase())) {
        clean = fullText.toLowerCase().trim();
      } else {
        continue;
      }
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
      else if (cmd === 'emoji') {
        if (args[0]) {
          config.emoji = args[0];
          saveConfig();
          await sock.sendMessage(remoteJid, {
            text: `🎨 *Emoji de Reação Atualizado:* ${config.emoji}`
          }, { quoted: m });
        }
      }
      else if (cmd === 'digitando') {
        if (!Array.isArray(config.alwaysTypingChats)) {
          config.alwaysTypingChats = [];
        }

        const subCmd = (args[0] || '').toLowerCase();

        // Listar chats com digitando ativo
        if (subCmd === 'list' || subCmd === 'lista') {
          if (config.alwaysTypingChats.length === 0) {
            await sock.sendMessage(remoteJid, {
              text: '✍️ *Sempre Digitando:* Nenhum chat ativo no momento.\nEnvie `.digitando` na conversa desejada para ativar.'
            }, { quoted: m });
          } else {
            const listText = config.alwaysTypingChats.map(c => `• ${c.split('@')[0]}`).join('\n');
            await sock.sendMessage(remoteJid, {
              text: `✍️ *Chats com "Sempre Digitando" Ativo (${config.alwaysTypingChats.length}):*\n\n${listText}\n\n_Para desativar, envie \`.digitando off\` na conversa._`
            }, { quoted: m });
          }
          return;
        }

        // Se passar um número como argumento (ex: .digitando 557499999999), usa ele; senão usa o chat atual
        let targetJid = remoteJid;
        const potentialPhone = (args[0] || '').replace(/\D/g, '');
        if (potentialPhone.length >= 10 && potentialPhone.length <= 15) {
          targetJid = `${potentialPhone}@s.whatsapp.net`;
        }

        const isCurrentlyActive = config.alwaysTypingChats.includes(targetJid);
        let shouldActivate = !isCurrentlyActive;

        if (['on', '1', 'ativar', 'sim', 'true'].includes(subCmd)) {
          shouldActivate = true;
        } else if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(subCmd)) {
          shouldActivate = false;
        }

        if (shouldActivate) {
          if (!config.alwaysTypingChats.includes(targetJid)) {
            config.alwaysTypingChats.push(targetJid);
          }
          saveConfig();
          try {
            await sock.sendPresenceUpdate('composing', targetJid);
          } catch {}
          await sock.sendMessage(remoteJid, {
            text: `✍️ *Sempre Digitando:* ATIVADO ✅\nChat: \`${targetJid.split('@')[0]}\`\n(Você aparecerá continuamente como "Digitando..." neste chat)`
          }, { quoted: m });
        } else {
          config.alwaysTypingChats = config.alwaysTypingChats.filter(c => c !== targetJid);
          saveConfig();
          try {
            await sock.sendPresenceUpdate('paused', targetJid);
          } catch {}
          await sock.sendMessage(remoteJid, {
            text: `⏸️ *Sempre Digitando:* DESATIVADO ❌\nChat: \`${targetJid.split('@')[0]}\`\n(Você não aparece mais digitando neste chat)`
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
          `✍️ *Sempre Digitando:* ${config.alwaysTypingChats?.length || 0} chat(s) ativo(s)\n` +
          `💾 *RAM:* ${ramMB} MB\n` +
          `⏱️ *Tempo Ativo:* ${h}h ${min}m ${s}s\n\n` +
          `*Comandos (Prefixo: \`.\`):*\n` +
          `• \`.visualizar\` - Só marca como lido\n` +
          `• \`.curtir\` [emoji] - Só curte (mantém círculo verde)\n` +
          `• \`.ambos\` [emoji] - Visualiza e curte juntos\n` +
          `• \`.desligar\` - Desativa a função\n` +
          `• \`.emoji <emoji>\` - Troca o emoji de curtida\n` +
          `• \`.status\` - Mostra este painel`;

        await sock.sendMessage(remoteJid, { text: msg }, { quoted: m });
      }
    }
  });
}

startBot();
