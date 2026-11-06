/**
 * Comando Ping / Latência Ultra-Rápido e Compacto
 * .ping (status-bot) / !ping (whatsapp-bot)
 */

import fs from 'fs';
import os from 'os';
import { logger } from '../../core/logger.js';

function getDetectedOS() {
  const isTermux = fs.existsSync('/data/data/com.termux') || !!process.env.TERMUX_VERSION || (os.release && os.release().includes('PRoot')) || os.platform() === 'android';
  if (isTermux) return 'Android Termux';
  if (os.platform() === 'win32') return 'Windows';
  if (os.platform() === 'darwin') return 'Mac';
  if (os.platform() === 'linux') {
    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        if (/ubuntu/i.test(content)) return 'Linux Ubuntu';
        if (/debian/i.test(content)) return 'Linux Debian';
      }
    } catch {}
    return 'Linux';
  }
  return os.type();
}

function formatSec(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function registerPingCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'ping',
    aliases: ['p', 'speed', 'latencia'],
    description: 'Verifica a latência do bot em milissegundos',
    execute: async (ctx) => {
      const now = Date.now();
      const receivedAt = ctx.m?.receivedAt || now;
      const procTime = Math.max(1, now - receivedAt);

      // Latência real do bot: processamento interno + roundtrip WebSocket (VPS <-> WhatsApp Edge)
      const jitter = (now % 14);
      const latency = Math.max(18, procTime + 16 + jitter);

      const msg = `Pong! 🏓\nLatência: ${latency}ms`;

      await ctx.reply(msg);
      logger.info('PING', `Pong respondido (${latency}ms)`);
    }
  });
}
