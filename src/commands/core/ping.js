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
    description: 'Verifica o status de hardware e software do bot',
    execute: async (ctx) => {
      const cfg = ctx.config || {};
      const botName = cfg.botName || (ctx.prefix === '!' ? 'Meu Assistente' : 'Status Bot Pessoal');
      const osName = getDetectedOS();
      const nodeVer = process.version.split('.')[0];
      const botUptime = formatSec(process.uptime());
      const hostUptime = formatSec(os.uptime());
      const load = (os.loadavg()[0] || 0).toFixed(2);
      const totalMB = Math.round(os.totalmem() / (1024 * 1024));
      const usedMB = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
      const pct = Math.round((usedMB / totalMB) * 100);
      const botMB = Math.round(process.memoryUsage().rss / (1024 * 1024));

      const msg = `⚡ *${botName} - SISTEMA* (${osName} | Node ${nodeVer})\n` +
        `• *Uptime:* Bot ${botUptime} | Host ${hostUptime}\n` +
        `• *Recursos:* CPU ${load} | RAM ${usedMB}/${totalMB}MB (${pct}%) | Bot ${botMB}MB`;

      await ctx.reply(msg);
      logger.info('PING', `Ping respondido por ${botName} (${osName})`);
    }
  });
}
