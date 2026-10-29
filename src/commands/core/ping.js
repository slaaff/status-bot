/**
 * Comando Ping / Latência Ultra-Rápido
 * .ping (status-bot) / !ping (whatsapp-bot)
 */

import { logger } from '../../core/logger.js';

export function registerPingCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'ping',
    aliases: ['p', 'speed', 'latencia'],
    description: 'Verifica a latência e tempo de resposta do bot',
    execute: async (ctx) => {
      const now = Date.now();
      const rawTimestamp = ctx.m.messageTimestamp;
      const msgTimeMs = (typeof rawTimestamp === 'number' ? rawTimestamp * 1000 : Number(rawTimestamp) * 1000) || now;
      const inboundLatency = Math.max(0, now - msgTimeMs);

      const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const uptimeSec = Math.floor(process.uptime());
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const s = uptimeSec % 60;

      const sendStart = Date.now();
      await ctx.reply(
        `🏓 *Pong!*\n\n` +
        `⚡ *Processamento:* ${inboundLatency}ms\n` +
        `💾 *RAM:* ${ramMB} MB\n` +
        `⏱️ *Uptime:* ${h}h ${m}m ${s}s\n` +
        `⚙️ *Prefixo:* \`${ctx.prefix}\`\n` +
        `👥 *Público:* ${ctx.config.allowPublicCommands ? 'Liberado ✅' : 'Restrito 🔒'}`
      );
      const sendDuration = Date.now() - sendStart;
      logger.info('PING', `Resposta enviada em ${sendDuration}ms (Inbound: ${inboundLatency}ms)`);
    }
  });
}
