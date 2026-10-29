/**
 * Comando Ping / Latência
 * .ping
 */

export function registerPingCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'ping',
    description: 'Verifica a latência e tempo de resposta do bot',
    execute: async (ctx) => {
      const start = Date.now();
      const sent = await ctx.reply('🏓 Pong!');
      const latency = Date.now() - start;

      const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const uptimeSec = Math.floor(process.uptime());

      try {
        await ctx.sock.sendMessage(ctx.remoteJid, {
          edit: sent.key,
          text: `🏓 *Pong!*\n⚡ *Latência:* ${latency}ms\n💾 *RAM:* ${ramMB} MB\n⏱️ *Uptime:* ${uptimeSec}s`
        });
      } catch {
        // Se a edição de mensagem falhar, o pong inicial já foi enviado
      }
    }
  });
}
