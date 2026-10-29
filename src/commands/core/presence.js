/**
 * Comandos de Presença Fake (Digitando, Gravando áudio, Online, Parar, Resetar, Listar)
 * .digita, .grava, .online, .parar, .reset, .presenca
 */

export function registerPresenceCommands(dispatcher, presenceHandler) {
  const presenceAliases = [
    'digitando', 'typing',
    'grava', 'gravando', 'audio', 'áudio', 'rec',
    'online', 'disp',
    'presenca', 'presença',
    'parar', 'stop',
    'reset', 'resetar', 'desativardigita', 'limpardigita'
  ];

  async function getChatDisplayName(sock, jid) {
    if (jid.endsWith('@g.us')) {
      try {
        const meta = await sock.groupMetadata(jid);
        return meta.subject || 'Grupo';
      } catch {
        return 'Grupo';
      }
    }
    return `+${jid.split('@')[0]}`;
  }

  dispatcher.registerCommand({
    name: 'digita',
    aliases: presenceAliases,
    ownerOnly: true,
    description: 'Controla presença fake contínua (digitando, gravando, online)',
    execute: async (ctx) => {
      const { sock, remoteJid, command, args, prefix } = ctx;
      const subcmd = (args[0] || '').toLowerCase();
      const extra = (args[1] || '').toLowerCase();

      // 1. Reset geral de todos os chats (.reset, .digita reset, .digita off all)
      const isResetAll = ['reset', 'resetar', 'desativardigita', 'limpardigita'].includes(command) ||
                         (['off', '0', 'desativar', 'parar', 'stop', 'reset', 'limpar'].includes(subcmd) && ['all', 'todos', 'tudo'].includes(extra)) ||
                         (['off', '0', 'desativar', 'parar', 'stop', 'reset', 'limpar'].includes(command) && ['all', 'todos', 'tudo'].includes(subcmd)) ||
                         ['reset', 'resetar', 'limpar', 'limpartudo', 'desativartudo'].includes(subcmd) ||
                         subcmd === 'all' || subcmd === 'todos';

      if (isResetAll) {
        const count = await presenceHandler.resetAll();
        await ctx.reply(
          `🧹 *Presença Fake Resetada em Todos os Chats!*\n\nForam limpos e pausados *${count}* chat(s).\nSua conta agora está em estado normal em todas as conversas.`
        );
        return;
      }

      // 2. Listar onde a presença fake está ativa (.digita lista)
      if (['lista', 'list', 'status', 'chats', 'ativos', 'onde'].includes(subcmd)) {
        const activeChats = presenceHandler.getTypingChats();
        const activeJids = Object.keys(activeChats);

        if (activeJids.length === 0) {
          await ctx.reply('ℹ️ *Nenhum chat com presença fake ativa no momento.*');
          return;
        }

        let listText = `📋 *CHATS COM PRESENÇA FAKE ATIVA (${activeJids.length})*\n\n`;
        for (let i = 0; i < activeJids.length; i++) {
          const jid = activeJids[i];
          const info = activeChats[jid];
          const mode = (typeof info === 'object' ? info?.mode : info) || 'composing';
          let name = (typeof info === 'object' && info?.name) ? info.name : '';

          if (!name) {
            name = await getChatDisplayName(sock, jid);
            if (typeof activeChats[jid] === 'object') activeChats[jid].name = name;
          }

          const modeDesc = mode === 'recording'
            ? '🎙️ Gravando áudio...'
            : mode === 'available'
            ? '🟢 Online'
            : '⌨️ Digitando...';

          listText += `${i + 1}. *${name}*\n   • Modo: ${modeDesc}\n   • Tipo: ${jid.endsWith('@g.us') ? '👥 Grupo' : '👤 Privado'}\n   • JID: \`${jid}\`\n\n`;
        }

        await ctx.reply(listText.trim());
        return;
      }

      // 3. Desativar explicitamente no chat atual (.parar, .digita off)
      const isExplicitOff = ['parar', 'stop'].includes(command) ||
                            ['off', '0', 'desativar', 'parar', 'stop', 'nao', 'não', 'false'].includes(subcmd);

      if (isExplicitOff) {
        const activeChats = presenceHandler.getTypingChats();
        if (activeChats[remoteJid]) {
          await presenceHandler.removeChatPresence(remoteJid);
          await ctx.reply('⏹️ *Presença Fake Parada:* Desativada com sucesso neste chat.');
        } else {
          await ctx.reply('ℹ️ A presença fake já não estava ativa neste chat.');
        }
        return;
      }

      // 4. Determinar o modo alvo (Toggle inteligente)
      let targetMode = 'composing';
      if (['grava', 'gravando', 'audio', 'áudio', 'rec'].includes(command) ||
          ['grava', 'gravando', 'audio', 'áudio', 'rec', 'voz'].includes(subcmd)) {
        targetMode = 'recording';
      } else if (['online', 'disp'].includes(command) ||
                 ['online', 'disp', 'disponivel', 'disponível', 'available'].includes(subcmd)) {
        targetMode = 'available';
      } else {
        targetMode = 'composing';
      }

      const activeChats = presenceHandler.getTypingChats();
      const current = activeChats[remoteJid];
      const currentMode = typeof current === 'object' ? current?.mode : current;

      // Se já está ativo NO MESMO MODO -> Desliga (Toggle OFF)
      if (current && currentMode === targetMode) {
        await presenceHandler.removeChatPresence(remoteJid);
        const label = targetMode === 'recording'
          ? '🎙️ *Gravando áudio...*'
          : targetMode === 'available'
          ? '🟢 *Online*'
          : '⌨️ *Digitando...*';

        await ctx.reply(`⏹️ ${label} *DESATIVADO* neste chat.`);
        return;
      }

      // Se não está ativo ou estava em outro modo -> Liga / Atualiza (Toggle ON)
      const chatName = await getChatDisplayName(sock, remoteJid);
      await presenceHandler.setChatPresence(remoteJid, targetMode, chatName);

      const label = targetMode === 'recording'
        ? '🎙️ *Gravando áudio...*'
        : targetMode === 'available'
        ? '🟢 *Online*'
        : '⌨️ *Digitando...*';

      await ctx.reply(`✅ ${label} *ATIVADO* neste chat!`);
    }
  });
}
