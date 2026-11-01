/**
 * Comando de Painel de Status / Menu / Ajuda e Gerenciamento de Contatos
 * .status, .status lista, .status todos, .status selecionados, .status desativar <num>, .status ativar <num>
 * Suporta também comandos colados: .statuslista, .statislista, .statustodos, .statusdesativar, etc.
 */

import { formatPhone, getPhoneVariants, normalizePhone } from '../../core/phoneUtils.js';
import { extractTargetContact } from './statusControl.js';

export function registerStatusCommand(dispatcher, options = {}) {
  const { isFullBot = false } = options;

  dispatcher.registerCommand({
    name: 'status',
    aliases: [
      'st',
      'statuslista',
      'statislista',
      'stlista',
      'statustodos',
      'statusselecionados',
      'statusdesativar',
      'statusbloquear',
      'statusativar',
      'statusadd',
      'statusdel',
      'statuslimpar'
    ],
    ownerOnly: false,
    description: 'Exibe painel de status e gerencia regras de contatos',
    execute: async (ctx) => {
      const cfg = ctx.config;
      const store = ctx.store || {};
      const prefix = ctx.prefix;

      // Determina o subcomando
      let subcmd = (ctx.args[0] || '').toLowerCase();

      // Se o comando disparado foi um alias colado (ex: .statuslista, .statustodos):
      const invoked = ctx.command.toLowerCase();
      if (['statuslista', 'statislista', 'stlista'].includes(invoked)) {
        subcmd = 'lista';
      } else if (invoked === 'statustodos') {
        subcmd = 'todos';
      } else if (invoked === 'statusselecionados') {
        subcmd = 'selecionados';
      } else if (['statusdesativar', 'statusbloquear'].includes(invoked)) {
        subcmd = 'desativar';
      } else if (invoked === 'statusativar') {
        subcmd = 'ativar';
      } else if (invoked === 'statusadd') {
        subcmd = 'add';
      } else if (invoked === 'statusdel') {
        subcmd = 'del';
      } else if (invoked === 'statuslimpar') {
        subcmd = 'limpar';
      }

      // 1. SUBCOMANDO: LISTA (.status lista / .statuslista / .statislista)
      if (['lista', 'list', 'verlista'].includes(subcmd)) {
        const targetMode = (cfg.statusTarget || 'all').toLowerCase();
        const targetDesc = targetMode === 'selected' || targetMode === 'selecionados'
          ? '🎯 Apenas Contatos Selecionados'
          : '👥 Todos os Contatos (exceto bloqueados)';

        const modoDesc = cfg.mode === 'both'
          ? `Ambos (Ver e Curtir) ✨ (${cfg.emoji || '❤️'})`
          : cfg.mode === 'like'
          ? `Apenas Curtir 🟢 (${cfg.emoji || '❤️'})`
          : cfg.mode === 'view'
          ? 'Apenas Visualizar 👁️'
          : 'Desligado ❌';

        // Deduplicar e formatar listas
        const ignoredList = Array.isArray(cfg.statusIgnored) ? Array.from(new Set(cfg.statusIgnored)) : [];
        const selectedList = Array.isArray(cfg.statusSelected) ? Array.from(new Set(cfg.statusSelected)) : [];

        // Agrupar variantes por número legível
        const formatUniqueNumbers = (list) => {
          const seen = new Set();
          const formatted = [];
          for (const item of list) {
            const clean = normalizePhone(item);
            const key = clean.length >= 8 ? clean.slice(-8) : clean;
            if (!seen.has(key)) {
              seen.add(key);
              formatted.push(`• ${formatPhone(clean)}`);
            }
          }
          return formatted;
        };

        const formattedIgnored = formatUniqueNumbers(ignoredList);
        const formattedSelected = formatUniqueNumbers(selectedList);

        let msg = `📋 *CONFIGURAÇÃO DE STATUS* 📋\n\n` +
          `⚙️ *Modo:* ${modoDesc}\n` +
          `🎯 *Alvo:* ${targetDesc}\n\n` +
          `⛔ *Bloqueados / Ignorados (${formattedIgnored.length}):*\n` +
          (formattedIgnored.length > 0 ? formattedIgnored.join('\n') + '\n\n' : '_Nenhum contato bloqueado._\n\n') +
          `⭐ *Contatos Selecionados (${formattedSelected.length}):*\n` +
          (formattedSelected.length > 0 ? formattedSelected.join('\n') + '\n\n' : '_Nenhum contato cadastrado._\n\n') +
          `💡 *Comandos Úteis:*\n` +
          `• \`${prefix}status todos\` - Ativa para todos os contatos\n` +
          `• \`${prefix}status selecionados\` - Ativa apenas para selecionados\n` +
          `• \`${prefix}status desativar <número>\` - Bloqueia contato do status\n` +
          `• \`${prefix}status ativar <número>\` - Desbloqueia contato\n` +
          `• \`${prefix}status add <número>\` - Adiciona aos selecionados\n` +
          `• \`${prefix}status del <número>\` - Remove dos selecionados\n` +
          `• \`${prefix}status limpar ignorados\` - Limpa lista de bloqueados`;

        await ctx.reply(msg.trim());
        return;
      }

      // 2. SUBCOMANDO: TODOS (.status todos / .statustodos)
      if (['todos', 'all', 'tudo'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        ctx.configManager.save({ statusTarget: 'all' });
        await ctx.reply(
          '👥 *Modo Status: ATIVADO PARA TODOS* ✅\n\n' +
          'O bot agora processa status de todos os seus contatos (exceto os que estiverem na lista de bloqueados).'
        );
        return;
      }

      // 3. SUBCOMANDO: SELECIONADOS (.status selecionados / .statusselecionados)
      if (['selecionados', 'selected', 'sel'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        ctx.configManager.save({ statusTarget: 'selected' });
        const count = (ctx.config.statusSelected || []).length;
        await ctx.reply(
          `🎯 *Modo Status: APENAS SELECIONADOS* ✅\n\n` +
          `O bot processará status SOMENTE dos contatos selecionados (${count} contato(s) cadastrados).\n` +
          `💡 _Para cadastrar contatos: \`${prefix}status add <número>\`_`
        );
        return;
      }

      // 4. SUBCOMANDO: DESATIVAR / BLOQUEAR (.status desativar [número] / .statusbloquear)
      if (['desativar', 'bloquear', 'block', 'ignorar', 'off'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        // Se ctx.args tiver número no args[1] ou extractTargetContact
        const target = extractTargetContact(ctx);
        if (target) {
          const variants = getPhoneVariants(target);
          const currentIgnored = Array.isArray(ctx.config.statusIgnored) ? [...ctx.config.statusIgnored] : [];
          for (const v of variants) {
            if (!currentIgnored.includes(v)) currentIgnored.push(v);
          }
          const currentSelected = (ctx.config.statusSelected || []).filter(item => !variants.includes(item));
          ctx.configManager.save({ statusIgnored: currentIgnored, statusSelected: currentSelected });

          await ctx.reply(
            `⛔ *Contato Bloqueado no Status!*\n\n` +
            `📱 *Número:* ${formatPhone(target)}\n` +
            `O bot não vai mais visualizar nem curtir status deste contato.`
          );
          return;
        }

        // Sem número: desliga status
        ctx.configManager.save({ mode: 'off', autoViewStatus: false, autoLikeStatus: false });
        await ctx.reply('❌ *Status Bot: DESLIGADO*\n(Não visualiza e nem curte status)');
        return;
      }

      // 5. SUBCOMANDO: ATIVAR / DESBLOQUEAR (.status ativar [número])
      if (['ativar', 'desbloquear', 'unblock', 'liberar', 'on'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        const target = extractTargetContact(ctx);
        if (target) {
          const variants = getPhoneVariants(target);
          const currentIgnored = (ctx.config.statusIgnored || []).filter(item => !variants.includes(item));
          ctx.configManager.save({ statusIgnored: currentIgnored });

          await ctx.reply(
            `✅ *Contato Desbloqueado!*\n\n` +
            `📱 *Número:* ${formatPhone(target)}\n` +
            `Status deste contato agora serão processados normalmente.`
          );
          return;
        }

        // Sem número: ativa status
        const prevMode = ctx.config.mode === 'off' ? 'like' : (ctx.config.mode || 'like');
        ctx.configManager.save({ mode: prevMode, autoLikeStatus: true });
        await ctx.reply(`✅ *Status Bot: ATIVADO*\nModo: *${prevMode}*`);
        return;
      }

      // 6. SUBCOMANDO: ADD / ADICIONAR (.status add <número>)
      if (['add', 'adicionar', 'incluir'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        const target = extractTargetContact(ctx);
        if (!target) {
          return ctx.reply(`⚠️ Informe o número do contato: \`${prefix}status add 5583921490880\``);
        }

        const variants = getPhoneVariants(target);
        const currentSelected = Array.isArray(ctx.config.statusSelected) ? [...ctx.config.statusSelected] : [];
        for (const v of variants) {
          if (!currentSelected.includes(v)) currentSelected.push(v);
        }
        // Remove de bloqueados se estiver
        const currentIgnored = (ctx.config.statusIgnored || []).filter(item => !variants.includes(item));
        ctx.configManager.save({ statusSelected: currentSelected, statusIgnored: currentIgnored });

        await ctx.reply(
          `⭐ *Contato Adicionado aos Selecionados!*\n\n` +
          `📱 *Número:* ${formatPhone(target)}\n` +
          `💡 _Envie \`${prefix}status selecionados\` para ativar o modo restrito apenas a eles._`
        );
        return;
      }

      // 7. SUBCOMANDO: DEL / REMOVER (.status del <número>)
      if (['del', 'remover', 'rm', 'delete'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        const target = extractTargetContact(ctx);
        if (!target) {
          return ctx.reply(`⚠️ Informe o número do contato: \`${prefix}status del 5583921490880\``);
        }

        const variants = getPhoneVariants(target);
        const currentSelected = (ctx.config.statusSelected || []).filter(item => !variants.includes(item));
        const currentIgnored = (ctx.config.statusIgnored || []).filter(item => !variants.includes(item));
        ctx.configManager.save({ statusSelected: currentSelected, statusIgnored: currentIgnored });

        await ctx.reply(
          `🗑️ *Contato Removido das Listas de Status!*\n\n` +
          `📱 *Número:* ${formatPhone(target)}`
        );
        return;
      }

      // 8. SUBCOMANDO: LIMPAR (.status limpar ignorados / selecionados / todos)
      if (['limpar', 'clear', 'resetlist'].includes(subcmd)) {
        if (!ctx.isFromOwner) return ctx.reply('⚠️ Comando exclusivo para os donos.');
        const which = (ctx.args[1] || '').toLowerCase();
        if (['ignorados', 'bloqueados', 'ignorado', 'bloqueado'].includes(which)) {
          ctx.configManager.save({ statusIgnored: [] });
          return ctx.reply('🧹 Lista de contatos bloqueados/ignorados foi *limpa* com sucesso!');
        }
        if (['selecionados', 'selecionado'].includes(which)) {
          ctx.configManager.save({ statusSelected: [] });
          return ctx.reply('🧹 Lista de contatos selecionados foi *limpa* com sucesso!');
        }
        if (['tudo', 'todos', 'all'].includes(which)) {
          ctx.configManager.save({ statusIgnored: [], statusSelected: [] });
          return ctx.reply('🧹 Todas as listas de contatos (bloqueados e selecionados) foram limpas!');
        }
        return ctx.reply(`💡 Use: \`${prefix}status limpar ignorados\` ou \`${prefix}status limpar selecionados\``);
      }

      // 9. PAINEL GERAL (Quando chamado sem argumentos: .status ou .st)
      const modoDesc = cfg.mode === 'both'
        ? `Ambos (Ver e Curtir) ✨ (${cfg.emoji || '❤️'})`
        : cfg.mode === 'like'
        ? `Apenas Curtir 🟢 (${cfg.emoji || '❤️'}) (Círculo Verde Preservado)`
        : cfg.mode === 'view'
        ? 'Apenas Visualizar 👁️'
        : 'Desligado ❌';

      const targetDesc = (cfg.statusTarget === 'selected' || cfg.statusTarget === 'selecionados')
        ? 'Apenas Selecionados 🎯'
        : 'Todos os Contatos 👥';

      const uptimeSeconds = Math.floor(process.uptime());
      const h = Math.floor(uptimeSeconds / 3600);
      const min = Math.floor((uptimeSeconds % 3600) / 60);
      const s = uptimeSeconds % 60;
      const ramMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

      const presenceCount = Object.keys(store.typingChats || cfg.typingChats || {}).length;
      const ignoredCount = Array.isArray(cfg.statusIgnored) ? new Set(cfg.statusIgnored).size : 0;
      const selectedCount = Array.isArray(cfg.statusSelected) ? new Set(cfg.statusSelected).size : 0;

      let msg = `📊 *PAINEL DO BOT* 📊\n\n` +
        `🤖 *Comandos:* ${cfg.commandsEnabled ? 'Ativados ✅' : 'Desativados 🛑'}\n` +
        `👥 *Público:* ${cfg.allowPublicCommands ? 'Liberado ✅' : 'Restrito aos Donos 🔒'}\n` +
        `⚙️ *Modo de Status:* ${modoDesc}\n` +
        `🎯 *Alvo de Status:* ${targetDesc}\n` +
        `⛔ *Bloqueados:* ${ignoredCount} contato(s)\n` +
        `⭐ *Selecionados:* ${selectedCount} contato(s)\n` +
        `👁️ *Status Vistos:* ${store.statusViewedCount || 0}\n` +
        `👀 *Views Recebidas (Status):* ${store.statusViewsReceivedCount || 0}\n` +
        `❤️ *Status Curtidos:* ${store.statusLikedCount || 0}\n` +
        `⌨️ *Presença Fake:* ${presenceCount} chat(s) ativo(s)\n`;

      if (isFullBot) {
        msg += `✨ *Figurinhas Feitas:* ${store.stickersCreatedCount || 0}\n` +
               `🎵 *Músicas Baixadas:* ${store.musicDownloadedCount || 0}\n` +
               `📥 *Auto-Download:* ${cfg.autoDownload ? 'Ativado ✅' : 'Desativado ❌'}\n` +
               `🗑️ *Auto-Apagar:* ${cfg.autoDeleteWord ? 'Ativado ✅' : 'Desativado ❌'}\n` +
               `📺 *Notificação Anime:* ${cfg.autoAnimeNotify ? 'Ativado ✅' : 'Desativado ❌'}\n`;
      }

      msg += `💾 *RAM:* ${ramMB} MB\n` +
             `⏱️ *Uptime:* ${h}h ${min}m ${s}s\n\n` +
             `_Envie \`${prefix}status lista\` para ver e gerenciar os contatos._`;

      await ctx.reply(msg.trim());
    }
  });

  // Comando .menu / .ajuda específico para status-bot se não for fullBot
  if (!isFullBot) {
    dispatcher.registerCommand({
      name: 'menu',
      aliases: ['ajuda', 'help'],
      ownerOnly: false,
      description: 'Exibe o menu de comandos do Status Bot',
      execute: async (ctx) => {
        const prefix = ctx.prefix;
        const msg = `⚡ *STATUS BOT PESSOAL* ⚡\n\n` +
          `*Comandos de Status (Prefixo: \`${prefix}\`):*\n` +
          `• \`${prefix}status\` - Mostra estatísticas e painel\n` +
          `• \`${prefix}status lista\` - Lista contatos bloqueados e selecionados\n` +
          `• \`${prefix}status todos\` - Ativa status para todos os contatos\n` +
          `• \`${prefix}status selecionados\` - Ativa apenas para contatos selecionados\n` +
          `• \`${prefix}status desativar <número>\` - Bloqueia contato do status\n` +
          `• \`${prefix}status ativar <número>\` - Desbloqueia contato\n` +
          `• \`${prefix}status add <número>\` - Adiciona aos selecionados\n` +
          `• \`${prefix}status del <número>\` - Remove dos selecionados\n` +
          `• \`${prefix}visualizar\` - Só marca status como lido\n` +
          `• \`${prefix}curtir\` [emoji] - Só curte (mantém círculo verde no celular)\n` +
          `• \`${prefix}ambos\` [emoji] - Visualiza e curte juntos\n` +
          `• \`${prefix}desligar\` / \`${prefix}desativar\` - Desativa visualizador e curtidas\n` +
          `• \`${prefix}emoji <emoji>\` - Troca o emoji de curtida\n\n` +
          `*Outros Comandos:*\n` +
          `• \`${prefix}bot [on/off]\` - Ativa ou desativa comandos do bot\n` +
          `• \`${prefix}publico [on/off]\` - Libera/bloqueia comandos para o público\n` +
          `• \`${prefix}digita\` / \`${prefix}grava\` / \`${prefix}online\` - Presença fake\n` +
          `• \`${prefix}parar\` / \`${prefix}reset\` - Para presença fake\n` +
          `• \`${prefix}ping\` - Tempo de resposta\n` +
          `• \`${prefix}restart\` - Reinicia o bot`;

        await ctx.reply(msg.trim());
      }
    });
  }
}
