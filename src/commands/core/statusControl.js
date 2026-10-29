/**
 * Comandos de Controle de Status do WhatsApp
 * .visualizar, .curtir, .ambos, .desligar, .emoji, .autostatus, .autolike
 */

export function registerStatusControlCommands(dispatcher) {
  // 1. .visualizar
  dispatcher.registerCommand({
    name: 'visualizar',
    ownerOnly: true,
    description: 'Ativa apenas a visualização automática de status',
    execute: async (ctx) => {
      ctx.configManager.save({ mode: 'view' });
      await ctx.reply(
        '👁️ *Status Bot:* Modo *Apenas Visualizar* ATIVADO ✅\n(Status serão marcados como vistos sem enviar nenhuma reação/curtida)'
      );
    }
  });

  // 2. .curtir [emoji]
  dispatcher.registerCommand({
    name: 'curtir',
    ownerOnly: true,
    description: 'Ativa apenas a curtida automática mantendo o círculo verde',
    execute: async (ctx) => {
      const emoji = ctx.args[0] && ctx.args[0].length <= 4 ? ctx.args[0] : ctx.config.emoji || '❤️';
      ctx.configManager.save({ mode: 'like', emoji, autoLikeEmoji: emoji });
      await ctx.reply(
        `❤️ *Status Bot:* Modo *Apenas Curtir* ATIVADO ✅ (Emoji: ${emoji})\n🟢 *Círculo Verde Preservado:* O bot reage aos status SEM marcar como lido, continuando como não visto no celular.`
      );
    }
  });

  // 3. .ambos [emoji]
  dispatcher.registerCommand({
    name: 'ambos',
    ownerOnly: true,
    description: 'Ativa visualização e curtida simultâneas de status',
    execute: async (ctx) => {
      const emoji = ctx.args[0] && ctx.args[0].length <= 4 ? ctx.args[0] : ctx.config.emoji || '❤️';
      ctx.configManager.save({ mode: 'both', emoji, autoLikeEmoji: emoji });
      await ctx.reply(
        `✨ *Status Bot:* Modo *Ambos* ATIVADO ✅ (Visualizar e Curtir)\n(Status serão visualizados e curtidos com ${emoji} imediatamente)`
      );
    }
  });

  // 4. .desligar
  dispatcher.registerCommand({
    name: 'desligar',
    ownerOnly: true,
    description: 'Desativa o visualizador e curtidor de status',
    execute: async (ctx) => {
      ctx.configManager.save({ mode: 'off' });
      await ctx.reply('❌ *Status Bot:* DESLIGADO\n(Não visualiza e nem curte status)');
    }
  });

  // 5. .emoji <emoji>
  dispatcher.registerCommand({
    name: 'emoji',
    ownerOnly: true,
    description: 'Define o emoji para reações em status',
    execute: async (ctx) => {
      if (!ctx.args[0]) {
        await ctx.reply(`🎨 *Emoji Atual:* ${ctx.config.emoji || '❤️'}\nUse: \`${ctx.prefix}emoji 💚\``);
        return;
      }
      const emoji = ctx.args[0];
      ctx.configManager.save({ emoji, autoLikeEmoji: emoji });
      await ctx.reply(`🎨 *Emoji de Reação Atualizado:* ${emoji}`);
    }
  });

  // 6. .autostatus [on/off] (compatibilidade com whatsapp-bot)
  dispatcher.registerCommand({
    name: 'autostatus',
    ownerOnly: true,
    description: 'Ativa ou desativa a visualização de status',
    execute: async (ctx) => {
      const opt = (ctx.args[0] || '').toLowerCase();
      let newState;
      if (['on', '1', 'ativar', 'sim', 'true'].includes(opt)) newState = true;
      else if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) newState = false;
      else newState = !ctx.config.autoViewStatus;

      ctx.configManager.save({ autoViewStatus: newState });
      await ctx.reply(
        `👁️ *Visualizador de Status:* ${newState ? 'ATIVADO ✅' : 'DESATIVADO ❌'}`
      );
    }
  });

  // 7. .autolike [on/off] [emoji] (compatibilidade com whatsapp-bot)
  dispatcher.registerCommand({
    name: 'autolike',
    ownerOnly: true,
    description: 'Ativa ou desativa a curtida automática de status',
    execute: async (ctx) => {
      const opt = (ctx.args[0] || '').toLowerCase();
      let newState;
      if (['on', '1', 'ativar', 'sim', 'true'].includes(opt)) newState = true;
      else if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) newState = false;
      else newState = !ctx.config.autoLikeStatus;

      const emoji = ctx.args[1] || ctx.config.autoLikeEmoji || '❤️';
      ctx.configManager.save({ autoLikeStatus: newState, autoLikeEmoji: emoji, emoji });

      await ctx.reply(
        `❤️ *Auto-Like Status:* ${newState ? `ATIVADO ✅ (Emoji: ${emoji})` : 'DESATIVADO ❌'}`
      );
    }
  });
}
