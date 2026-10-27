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

async function pair() {
  console.log('\n======================================================');
  console.log('       ⚡ WHATSAPP STATUS BOT - PAREAMENTO VIA QR ⚡');
  console.log('======================================================\n');

  // Parar qualquer instância no PM2 para evitar conflito
  try {
    execSync('pm2 stop status-bot 2>/dev/null', { stdio: 'ignore' });
  } catch {}

  // Limpa sessão antiga para garantir QR novo e limpo
  if (fs.existsSync('./session')) {
    fs.rmSync('./session', { recursive: true, force: true });
    console.log('🗑️  Sessão anterior limpa para novo pareamento.');
  }

  console.log('⏳ Gerando QR Code... Aguarde alguns segundos.\n');

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') || false
  });

  sock.ev.on('creds.update', saveCreds);

  let qrCount = 0;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCount++;
      console.log('======================================================');
      console.log(`  📱 QR CODE #${qrCount} - Escaneie com seu WhatsApp:`);
      console.log('======================================================');
      console.log('  1. Abra o WhatsApp no seu celular');
      console.log('  2. Vá em Aparelhos Conectados > Conectar um aparelho');
      console.log('  3. Aponte a câmera para o QR Code abaixo:\n');
      qrcode.generate(qr, { small: true });
      fs.writeFileSync('./qr.txt', qr);
      console.log('\n  ⏳ Aguardando você escanear com a câmera...\n');

      if (qrCount >= 6) {
        console.log('❌ Limite de QR codes atingido. Reinicie o script se necessário.');
        process.exit(1);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('\n❌ Sessão cancelada ou desconectada. Tente novamente.');
        process.exit(1);
      }
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect && qrCount < 6) {
        setTimeout(pair, 3000);
      }
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('  ✅ WHATSAPP PAREADO E CONECTADO COM SUCESSO!');
      console.log('======================================================\n');
      console.log('🚀 Iniciando o Status Bot no PM2 para rodar 24/7...');

      try {
        execSync('pm2 restart status-bot 2>/dev/null || pm2 start index.js --name status-bot', {
          cwd: '/home/ubuntu/status-bot',
          stdio: 'inherit'
        });
        execSync('pm2 save 2>/dev/null', { stdio: 'ignore' });
        console.log('\n======================================================');
        console.log('  🎉 TUDO PRONTO! O BOT JÁ ESTÁ ATIVO E LIGADO.');
        console.log(`  ⚙️  Modo: ${config.mode.toUpperCase()} (Emoji: ${config.emoji})`);
        console.log('  Você já pode fechar esta janela com tranquilidade.');
        console.log('======================================================\n');
      } catch (err) {
        console.error('Erro ao iniciar no PM2:', err.message);
      }
      setTimeout(() => process.exit(0), 2000);
    }
  });
}

pair().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
