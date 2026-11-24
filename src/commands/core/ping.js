import fs from 'fs';
import os from 'os';
import { logger } from '../../core/logger.js';

export function registerPingCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'ping',
    aliases: ['p', 'speed', 'latencia'],
    description: 'Verifica a latência do bot em milissegundos',
    execute: async (ctx) => {
      const now = Date.now();
      const receivedAt = ctx.m?.receivedAt || now;
      // Latência real direta de processamento e resposta do bot
      const latency = Math.max(1, now - receivedAt);

      const msg = `Pong! 🏓\nLatência: ${latency}ms`;

      await ctx.reply(msg);
      logger.info('PING', `Pong respondido (${latency}ms)`);
    }
  });
}
