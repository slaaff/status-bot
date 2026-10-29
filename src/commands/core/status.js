/**
 * Comando de Painel de Status / Menu / Ajuda
 * .status, .menu, .ajuda
 */

export function registerStatusCommand(dispatcher, options = {}) {
  const { isFullBot = false } = options;

  dispatcher.registerCommand({
    name: 'status',
    aliases: ['st'],
    ownerOnly: true,
    description: 'Exibe o painel de status e recursos do bot',
    execute: async (ctx) => {
      const cfg = ctx.config;
      const store = ctx.store;

      const modoDesc = cfg.mode === 'both'
        ? `Ambos (Ver e Curtir) ✨ (${cfg.emoji || '❤️'})`
        : cfg.mode === 'like'
        ? `Apenas Curtir 🟢 (${cfg.emoji || '❤️'}) (Círculo Verde Preservado)`
        : cfg.mode === 'view'
        ? 'Apenas Visualizar 👁️'
        : 'Desligado ❌';

      const uptimeSeconds = Math.floor(process.uptime());
      const h = Math.floor(uptimeSeconds / 3600);
      const min = Math.floor((uptimeSeconds % 3600) / 60);
      const s = uptimeSeconds % 60;
      const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

      const presenceCount = Object.keys(store.typingChats || cfg.typingChats || {}).length;

      let msg = `📊 *PAINEL DO BOT* 📊\n\n` +
        `⚙️ *Modo de Status:* ${modoDesc}\n` +
        `👁️ *Status Vistos:* ${store.statusViewedCount || 0}\n` +
        `👀 *Views Recebidas (Status):* ${store.statusViewsReceivedCount || 0}\n` +
        `❤️ *Status Curtidos:* ${store.statusLikedCount || 0}\n` +
        `⌨️ *Presença Fake:* ${presenceCount} chat(s) ativo(s)\n`;

      if (isFullBot) {
        msg += `✨ *Figurinhas Feitas:* ${store.stickersCreatedCount || 0}\n` +
               `🎵 *Músicas Baixadas:* ${store.musicDownloadedCount || 0}\n` +
               `📥 *Auto-Download:* ${cfg.autoDownload !== false ? 'Ativado ✅' : 'Desativado ❌'}\n` +
               `🗑️ *Auto-Apagar:* ${cfg.autoDeleteWord !== false ? 'Ativado ✅' : 'Desativado ❌'}\n` +
               `📺 *Notificação Anime:* ${cfg.autoAnimeNotify !== false ? 'Ativado ✅' : 'Desativado ❌'}\n`;
      }

      msg += `💾 *RAM:* ${ramMB} MB\n` +
             `⏱️ *Uptime:* ${h}h ${min}m ${s}s\n\n` +
             `_Envie \`${ctx.prefix}menu\` para ver os comandos disponíveis._`;

      await ctx.reply(msg.trim());
    }
  });

  // Comando .menu / .ajuda específico para status-bot se não for fullBot
  if (!isFullBot) {
    dispatcher.registerCommand({
      name: 'menu',
      aliases: ['ajuda', 'help'],
      ownerOnly: true,
      description: 'Exibe o menu de comandos do Status Bot',
      execute: async (ctx) => {
        const prefix = ctx.prefix;
        const msg = `⚡ *STATUS BOT PESSOAL* ⚡\n\n` +
          `*Comandos (Prefixo: \`${prefix}\`):*\n` +
          `• \`${prefix}digita\` / \`${prefix}grava\` / \`${prefix}online\` - Presença fake (toggle)\n` +
          `• \`${prefix}parar\` - Para presença fake no chat atual\n` +
          `• \`${prefix}reset\` - Reseta presença fake em todos os chats\n` +
          `• \`${prefix}digita lista\` - Lista conversas com presença ativa\n` +
          `• \`${prefix}visualizar\` - Só marca status como lido\n` +
          `• \`${prefix}curtir\` [emoji] - Só curte (mantém círculo verde no celular)\n` +
          `• \`${prefix}ambos\` [emoji] - Visualiza e curte juntos\n` +
          `• \`${prefix}desligar\` - Desativa visualizador e curtidas\n` +
          `• \`${prefix}emoji <emoji>\` - Troca o emoji de curtida\n` +
          `• \`${prefix}status\` - Mostra estatísticas e painel\n` +
          `• \`${prefix}ping\` - Verifica tempo de resposta do bot\n` +
          `• \`${prefix}restart\` - Reinicia o bot`;

        await ctx.reply(msg.trim());
      }
    });
  }
}
