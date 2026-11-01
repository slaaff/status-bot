/**
 * Comandos de Controle de Status do WhatsApp
 * .visualizar, .curtir, .ambos, .desligar, .desativar, .ativar, .emoji, .autostatus, .autolike
 */

import { normalizePhone, formatPhone, getPhoneVariants, isPhoneInList } from '../../core/phoneUtils.js';

export function extractTargetContact(ctx) {
  // 1. Menção direta
  const mentions = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (Array.isArray(mentions) && mentions.length > 0) {
    return normalizePhone(mentions[0]);
  }

  // 2. Mensagem citada (quoted)
  const quotedParticipant = ctx.m.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) {
    return normalizePhone(quotedParticipant);
  }

  // 3. Busca nos argumentos por números de pelo menos 8 dígitos
  if (Array.isArray(ctx.args)) {
    for (const arg of ctx.args) {
      const clean = normalizePhone(arg);
      if (clean && clean.length >= 8) {
        return clean;
      }
    }
  }

  return null;
}

export function registerStatusControlCommands(dispatcher) {
  // 1. .visualizar
  dispatcher.registerCommand({
    name: 'visualizar',
    ownerOnly: true,
    description: 'Ativa apenas a visualização automática de status',
    execute: async (ctx) => {
      const opt = (ctx.args[0] || '').toLowerCase();
      if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) {
        ctx.configManager.save({ mode: 'off', autoViewStatus: false });
        await ctx.reply('👁️ *Visualizador de Status:* DESATIVADO ❌');
        return;
      }

      ctx.configManager.save({ mode: 'view', autoViewStatus: true });
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
      const opt = (ctx.args[0] || '').toLowerCase();
      if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) {
        ctx.configManager.save({ mode: 'off', autoLikeStatus: false });
        await ctx.reply('❤️ *Curtida de Status:* DESATIVADA ❌');
        return;
      }

      const emoji = ctx.args[0] && ctx.args[0].length <= 4 ? ctx.args[0] : ctx.config.emoji || '❤️';
      ctx.configManager.save({ mode: 'like', emoji, autoLikeEmoji: emoji, autoLikeStatus: true });
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
      ctx.configManager.save({ mode: 'both', emoji, autoLikeEmoji: emoji, autoViewStatus: true, autoLikeStatus: true });
      await ctx.reply(
        `✨ *Status Bot:* Modo *Ambos* ATIVADO ✅ (Visualizar e Curtir)\n(Status serão visualizados e curtidos com ${emoji} imediatamente)`
      );
    }
  });

  // 4. .desligar / .desativar [número]
  dispatcher.registerCommand({
    name: 'desligar',
    aliases: ['desativar', 'statusdesativar', 'statusoff', 'off', 'bloquear', 'block'],
    ownerOnly: true,
    description: 'Desativa o bot de status ou bloqueia contato específico',
    execute: async (ctx) => {
      const target = extractTargetContact(ctx);

      // Se passou contato (ex: .desativar 5583921490880 ou citando alguém):
      if (target) {
        const variants = getPhoneVariants(target);
        const currentIgnored = Array.isArray(ctx.config.statusIgnored) ? [...ctx.config.statusIgnored] : [];

        let addedAny = false;
        for (const v of variants) {
          if (!currentIgnored.includes(v)) {
            currentIgnored.push(v);
            addedAny = true;
          }
        }

        // Também remove de selecionados se estiver lá
        const currentSelected = (ctx.config.statusSelected || []).filter(item => !variants.includes(item));

        ctx.configManager.save({
          statusIgnored: currentIgnored,
          statusSelected: currentSelected
        });

        await ctx.reply(
          `⛔ *Contato Bloqueado no Status!*\n\n` +
          `📱 *Número:* ${formatPhone(target)}\n` +
          `❌ O bot *NÃO* vai mais visualizar nem curtir status deste contato.\n\n` +
          `💡 _Para desbloquear: \`${ctx.prefix}status ativar ${target}\`_`
        );
        return;
      }

      // Se chamado sem argumentos (ex: .desativar ou .desligar):
      ctx.configManager.save({
        mode: 'off',
        autoViewStatus: false,
        autoLikeStatus: false
      });
      await ctx.reply(
        '❌ *Status Bot: DESLIGADO*\n\n' +
        'O bot parou de visualizar e curtir status completamente.\n\n' +
        `💡 _Para religar: \`${ctx.prefix}curtir\`, \`${ctx.prefix}visualizar\`, \`${ctx.prefix}ambos\` ou \`${ctx.prefix}ativar\`_`
      );
    }
  });

  // 5. .ativar [todos / selecionados / número]
  dispatcher.registerCommand({
    name: 'ativar',
    aliases: ['statusativar', 'statuson', 'ligar', 'on'],
    ownerOnly: true,
    description: 'Ativa o bot de status ou desbloqueia contato',
    execute: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();

      // Ativar para todos
      if (['todos', 'all', 'tudo'].includes(sub)) {
        ctx.configManager.save({ statusTarget: 'all' });
        await ctx.reply(
          '👥 *Modo Status: ATIVADO PARA TODOS* ✅\n\n' +
          'O bot processará status de todos os contatos (exceto os que estiverem na lista de bloqueados).'
        );
        return;
      }

      // Ativar apenas selecionados
      if (['selecionados', 'selected', 'sel'].includes(sub)) {
        ctx.configManager.save({ statusTarget: 'selected' });
        const count = (ctx.config.statusSelected || []).length;
        await ctx.reply(
          `🎯 *Modo Status: APENAS SELECIONADOS* ✅\n\n` +
          `O bot processará status SOMENTE dos contatos cadastrados (${count} contato(s) na lista).\n` +
          `💡 _Para adicionar um contato: \`${ctx.prefix}status add <número>\`_`
        );
        return;
      }

      // Se passou contato para desbloquear (ex: .ativar 5583921490880):
      const target = extractTargetContact(ctx);
      if (target) {
        const variants = getPhoneVariants(target);
        const currentIgnored = (ctx.config.statusIgnored || []).filter(item => !variants.includes(item));
        const currentSelected = Array.isArray(ctx.config.statusSelected) ? [...ctx.config.statusSelected] : [];

        // Se o modo atual for selecionados, adiciona em selecionados
        if (ctx.config.statusTarget === 'selected') {
          for (const v of variants) {
            if (!currentSelected.includes(v)) currentSelected.push(v);
          }
        }

        ctx.configManager.save({
          statusIgnored: currentIgnored,
          statusSelected: currentSelected
        });

        await ctx.reply(
          `✅ *Contato Desbloqueado no Status!*\n\n` +
          `📱 *Número:* ${formatPhone(target)}\n` +
          `Status deste contato agora serão processados normalmente.`
        );
        return;
      }

      // Se chamado sem argumentos (ex: .ativar):
      const prevMode = ctx.config.mode === 'off' ? 'like' : (ctx.config.mode || 'like');
      ctx.configManager.save({
        mode: prevMode,
        autoLikeStatus: true
      });
      await ctx.reply(
        `✅ *Status Bot: ATIVADO*\n\n` +
        `Modo atual: *${prevMode === 'both' ? 'Ambos (Ver e Curtir)' : prevMode === 'like' ? 'Apenas Curtir' : 'Apenas Visualizar'}*\n` +
        `Alvo: *${ctx.config.statusTarget === 'selected' ? 'Apenas Selecionados 🎯' : 'Todos os Contatos 👥'}*`
      );
    }
  });

  // 6. .emoji <emoji>
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

  // 7. .autostatus [on/off]
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

      const newMode = newState ? (ctx.config.mode === 'like' ? 'both' : 'view') : (ctx.config.mode === 'both' ? 'like' : 'off');
      ctx.configManager.save({ autoViewStatus: newState, mode: newMode });
      await ctx.reply(
        `👁️ *Visualizador de Status:* ${newState ? 'ATIVADO ✅' : 'DESATIVADO ❌'}`
      );
    }
  });

  // 8. .autolike [on/off] [emoji]
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
      const newMode = newState ? (ctx.config.mode === 'view' ? 'both' : 'like') : (ctx.config.mode === 'both' ? 'view' : 'off');
      ctx.configManager.save({ autoLikeStatus: newState, autoLikeEmoji: emoji, emoji, mode: newMode });

      await ctx.reply(
        `❤️ *Auto-Like Status:* ${newState ? `ATIVADO ✅ (Emoji: ${emoji})` : 'DESATIVADO ❌'}`
      );
    }
  });
}
