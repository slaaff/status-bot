/**
 * WhatsApp Status Bot (Dedicado & Ultraleve)
 * 
 * Funções Exclusivas:
 * - Visualizador e Curtidor Automático de Status (Stories)
 * - Modos: Só Visualizar, Só Curtir (mantém círculo verde), Ambos e Desligado
 * - Isolamento Total: Ignora 100% de terceiros e grupos, aceita apenas comandos 'fromMe'
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const configPath = path.resolve('./config.json');
const statsPath = path.resolve('./stats.json');

function loadConfig() {
  const defaults = {
    mode: 'both', // 'view' | 'like' | 'both' | 'off'
    emoji: '❤️',
    phoneNumber: '5574998000519'
  };
  try {
    if (fs.existsSync(configPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch {}
  return defaults;
}

let config = loadConfig();
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function loadStats() {
  const defaults = { viewed: 0, liked: 0 };
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
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    saveStatsTimer = null;
  }, 2000);
}

async function startBot() {
  config = loadConfig();
  stats = loadStats();

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: 20000,
    keepAliveIntervalMs: 25000,
    shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') || false
  });

  sock.ev.on('creds.update', saveCreds);

  // Solicitar Pairing Code se ainda não estiver registrado
  if (!state.creds.registered) {
    const phoneNumber = (config.phoneNumber || '5574998000519').replace(/\D/g, '');
    console.log(`\n⏳ Solicitando Código de Pareamento para o número +${phoneNumber}...`);

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n====================================================`);
        console.log(`  🔑 CÓDIGO DE PAREAMENTO: ${code}`);
        console.log(`  📱 No seu WhatsApp vá em:`);
        console.log(`     Aparelhos conectados > Conectar com número`);
        console.log(`====================================================\n`);
        fs.writeFileSync('./pairing_code.txt', code);
      } catch (err) {
        console.error('❌ Erro ao solicitar código de pareamento:', err.message);
      }
    }, 4000);
  }

  // Monitorar conexão
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[CONEXÃO] Fechada (${statusCode}). Reconectando: ${shouldReconnect ? 'Sim' : 'Não'}`);

      if (shouldReconnect) {
        setTimeout(startBot, 4000);
      } else {
        console.log('[CONEXÃO] Sessão desconectada. Apague a pasta ./session e reinicie.');
      }
    } else if (connection === 'open') {
      console.log('\n====================================================');
      console.log('  ✅ STATUS BOT CONECTADO COM SUCESSO!');
      console.log(`  ⚙️ Modo Ativo: ${config.mode.toUpperCase()} (Emoji: ${config.emoji})`);
      console.log('====================================================\n');
    }
  });

  // Processar Mensagens
  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || messages.length === 0) return;

    for (const m of messages) {
      if (!m.message) continue;

      const remoteJid = m.key.remoteJid;

      // 1. PROCESSAR STATUS (STORIES) - Execução Imediata
      if (remoteJid === 'status@broadcast') {
        if (m.key.fromMe || !m.key.participant) continue;
        if (config.mode === 'off') continue;

        (async () => {
          try {
            const statusKey = {
              remoteJid: 'status@broadcast',
              id: m.key.id,
              participant: m.key.participant
            };
            const sender = (m.key.participant || '').split('@')[0] || 'Contato';

            // Modo Visualizar ou Ambos -> marca como lido
            if (config.mode === 'view' || config.mode === 'both') {
              await sock.readMessages([statusKey]);
              stats.viewed = (stats.viewed || 0) + 1;
              saveStats();
              console.log(`[STATUS] Visualizado de +${sender} (Total: ${stats.viewed})`);
            }

            // Modo Curtir ou Ambos -> reage no status
            // Se for apenas curtir (mode === 'like'), NÃO chama readMessages, mantendo o círculo verde no WhatsApp!
            if (config.mode === 'like' || config.mode === 'both') {
              await sock.sendMessage('status@broadcast', {
                react: {
                  text: config.emoji || '❤️',
                  key: statusKey
                }
              }, {
                statusJidList: [m.key.participant]
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

      // 2. ISOLAMENTO TOTAL: Ignora 100% de mensagens de terceiros e grupos
      if (!m.key.fromMe) continue;

      // Extrai texto da mensagem enviada por mim mesmo
      const fullText = (
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        ''
      ).trim();

      if (!fullText) continue;

      const prefixes = ['.', '!'];
      const usedPrefix = prefixes.find(p => fullText.startsWith(p));
      if (!usedPrefix) continue;

      const clean = fullText.slice(usedPrefix.length).trim();
      const parts = clean.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      // Comandos de Controle (Executados apenas se enviados pelo próprio dono)
      if (['visualizar', 'ver', 'sovisualizar'].includes(cmd)) {
        config.mode = 'view';
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: '👁️ *Status Bot:* Modo *Apenas Visualizar* ATIVADO ✅\n(Status serão marcados como vistos sem enviar nenhuma reação/curtida)'
        }, { quoted: m });
      }
      else if (['curtir', 'like', 'socurtir'].includes(cmd)) {
        config.mode = 'like';
        if (args[0] && args[0].length <= 4) config.emoji = args[0];
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: `❤️ *Status Bot:* Modo *Apenas Curtir* ATIVADO ✅ (Emoji: ${config.emoji || '❤️'})\n🟢 *Círculo Verde Preservado:* O bot reage aos status SEM marcar como lido, continuando como "não visto" no seu celular.`
        }, { quoted: m });
      }
      else if (['ambos', 'tudo', 'both'].includes(cmd)) {
        config.mode = 'both';
        if (args[0] && args[0].length <= 4) config.emoji = args[0];
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: `✨ *Status Bot:* Modo *Ambos* ATIVADO ✅ (Visualizar e Curtir)\n(Status serão visualizados e curtidos com ${config.emoji || '❤️'} imediatamente)`
        }, { quoted: m });
      }
      else if (['desligar', 'off', 'parar', 'stop'].includes(cmd)) {
        config.mode = 'off';
        saveConfig();
        await sock.sendMessage(remoteJid, {
          text: '❌ *Status Bot:* DESLIGADO\n(Não visualiza e nem curte status)'
        }, { quoted: m });
      }
      else if (['emoji'].includes(cmd)) {
        if (args[0]) {
          config.emoji = args[0];
          saveConfig();
          await sock.sendMessage(remoteJid, {
            text: `🎨 *Emoji de Reação Atualizado:* ${config.emoji}`
          }, { quoted: m });
        }
      }
      else if (['ping', 'status', 'info', 'menu', 'ajuda'].includes(cmd)) {
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
          `❤️ *Total Curtidos:* ${stats.liked || 0}\n` +
          `💾 *RAM:* ${ramMB} MB\n` +
          `⏱️ *Tempo Ativo:* ${h}h ${min}m ${s}s\n\n` +
          `*Comandos de Controle:*\n` +
          `• \`!visualizar\` ou \`.visualizar\` - Só marca como lido\n` +
          `• \`!curtir\` ou \`.curtir\` - Só curte (mantém círculo verde)\n` +
          `• \`!ambos\` ou \`.ambos\` - Visualiza e curte juntos\n` +
          `• \`!desligar\` ou \`.desligar\` - Desativa a função\n` +
          `• \`!emoji <emoji>\` - Troca o emoji de curtida\n` +
          `• \`!status\` ou \`.status\` - Mostra este painel`;

        await sock.sendMessage(remoteJid, { text: msg }, { quoted: m });
      }
    }
  });
}

startBot();
