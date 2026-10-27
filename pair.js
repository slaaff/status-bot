import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import { execSync } from 'child_process';

const configPath = path.resolve('./config.json');

function loadConfig() {
  const defaults = { mode: 'both', emoji: '❤️', phoneNumber: '5574998000519' };
  try {
    if (fs.existsSync(configPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch {}
  return defaults;
}

const config = loadConfig();

// 1. Parar PM2 para evitar conexões concorrentes
try {
  execSync('pm2 stop status-bot 2>/dev/null', { stdio: 'ignore' });
} catch {}

// 2. Limpar sessão anterior apenas se não estiver registrada
if (fs.existsSync('./session')) {
  try {
    const credsPath = path.resolve('./session/creds.json');
    if (!fs.existsSync(credsPath)) {
      fs.rmSync('./session', { recursive: true, force: true });
    } else {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (!creds.registered) {
        fs.rmSync('./session', { recursive: true, force: true });
      }
    }
  } catch {
    fs.rmSync('./session', { recursive: true, force: true });
  }
}

let activeSock = null;
let isReconnecting = false;
let isPaired = false;

async function startPairing() {
  console.log('\n======================================================');
  console.log('       ⚡ WHATSAPP STATUS BOT - PAREAMENTO VIA QR ⚡');
  console.log('======================================================\n');
  console.log('⏳ Inicializando Baileys... Aguarde o QR Code.\n');

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  if (activeSock) {
    try {
      activeSock.ev.removeAllListeners();
      activeSock.ws?.close();
    } catch {}
    activeSock = null;
  }

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') || false
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !state.creds.registered && !isPaired) {
      console.log('======================================================');
      console.log('  📱 ESCANEIE O QR CODE COM SEU WHATSAPP:');
      console.log('======================================================');
      console.log('  1. Abra o WhatsApp no seu celular');
      console.log('  2. Vá em Aparelhos Conectados > Conectar um aparelho');
      console.log('  3. Aponte a câmera para o QR Code abaixo:\n');
      qrcode.generate(qr, { small: true });
      fs.writeFileSync('./qr.txt', qr);
      console.log('\n  ⏳ Aguardando você escanear com a câmera...\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[CONEXÃO] Fechada (${statusCode}). Reconectar: ${shouldReconnect ? 'Sim' : 'Não'}`);

      if (isPaired) {
        // Socket foi encerrado de propósito após salvar credenciais
        return;
      }

      // IMPORTANTE: no código 515 (restartRequired), reconecta SEM apagar ./session!
      if (shouldReconnect) {
        if (!isReconnecting) {
          isReconnecting = true;
          console.log('Sincronizando chaves de autenticação...');
          setTimeout(() => {
            isReconnecting = false;
            startPairing();
          }, 3000);
        }
      } else {
        console.log('\n❌ Sessão cancelada ou recusada no celular.');
        process.exit(1);
      }
    } else if (connection === 'open') {
      isPaired = true;
      console.log('\n======================================================');
      console.log('  ✅ WHATSAPP PAREADO E CONECTADO COM SUCESSO!');
      console.log('======================================================\n');
      console.log('💾 Gravando credenciais no disco com segurança...');

      // Aguarda 4 segundos para gravar todas as chaves no disco
      setTimeout(async () => {
        console.log('🔌 Fechando conexão de pareamento...');
        try {
          sock.ev.removeAllListeners();
          sock.ws?.close();
        } catch {}

        // Aguarda 2 segundos para o WhatsApp registrar o fechamento limpo
        setTimeout(() => {
          console.log('🚀 Iniciando o Status Bot no PM2 para rodar 24/7...');
          try {
            execSync('pm2 restart status-bot 2>/dev/null || pm2 start index.js --name status-bot', {
              cwd: path.resolve('.'),
              stdio: 'inherit'
            });
            execSync('pm2 save 2>/dev/null', { stdio: 'ignore' });
            console.log('\n======================================================');
            console.log('  🎉 TUDO PRONTO! O BOT ESTÁ LIGADO E LOGADO NO PM2.');
            console.log(`  ⚙️ Modo Ativo: ${config.mode.toUpperCase()} (Emoji: ${config.emoji})`);
            console.log('  Você já pode fechar esta janela com tranquilidade!');
            console.log('======================================================\n');
          } catch (err) {
            console.error('Erro ao iniciar no PM2:', err.message);
          }
          setTimeout(() => process.exit(0), 1000);
        }, 2000);
      }, 4000);
    }
  });
}

startPairing().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
