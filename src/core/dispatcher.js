/**
 * Despachante Central de Mensagens e Comandos
 * - Roteamento ultra-rápido de comandos via Map O(1)
 * - Validação estrita de prefixo configurado (ex: '!' no whatsapp-bot, ';' no status-bot)
 * - Ignora sumariamente mensagens iniciadas pelos prefixos reservados do outro bot
 * - Suporte a comandos colados de status (ex: statuslista, statustodos)
 * - Trava mestre de comandos (bot on/off) e acesso público (publico on/off)
 * - Reconhecimento e aprendizado dinâmico de identificadores dos donos (LID e telefone)
 * - Hooks passivos modulares
 */

import { logger } from './logger.js';

export function createDispatcher(options) {
  const {
    configManager,
    storeManager,
    messageStore,
    prefix: forcedPrefix = null,
    ignoredPrefixes = []
  } = options;

  const commands = new Map();
  const aliases = new Map();
  const passiveHooks = [];

  function registerCommand(cmdDef) {
    if (!cmdDef.name || typeof cmdDef.execute !== 'function') {
      throw new Error('Comando inválido: nome e método execute são obrigatórios');
    }

    const name = cmdDef.name.toLowerCase();
    commands.set(name, cmdDef);

    if (Array.isArray(cmdDef.aliases)) {
      for (const alias of cmdDef.aliases) {
        aliases.set(alias.toLowerCase(), name);
      }
    }
  }

  function registerPassiveHook(hookFn) {
    if (typeof hookFn === 'function') {
      passiveHooks.push(hookFn);
    }
  }

  function extractMessageText(m) {
    let msg = m.message;
    if (!msg) return '';

    if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
    if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
    if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;

    return (
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.documentMessage?.caption ||
      msg.buttonsResponseMessage?.selectedButtonId ||
      msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
      msg.templateButtonReplyMessage?.selectedId ||
      ''
    ).trim();
  }

  async function handleMessage(m, sock) {
    if (!m.message) return;

    const remoteJid = m.key.remoteJid;
    if (!remoteJid) return;

    const fullText = extractMessageText(m);
    const config = configManager.get();

    const strictPrefix = forcedPrefix || config.prefix || '!';

    // Regra estrita: ignora mensagens iniciadas por prefixos reservados ao outro bot
    for (const ignored of ignoredPrefixes) {
      if (ignored && ignored !== strictPrefix && fullText.startsWith(ignored)) {
        return;
      }
    }

    const isCommand = Boolean(fullText.startsWith(strictPrefix));

    const isGroup = remoteJid.endsWith('@g.us');
    const participant = m.key.participant || m.participant || (isGroup ? '' : remoteJid);
    const sender = participant || remoteJid;
    const store = storeManager ? storeManager.get() : null;

    // Reconhecimento dos donos
    const isFromOwner = Boolean(
      m.key.fromMe ||
      configManager.isOwner(sender, sock.user, store) ||
      (participant && configManager.isOwner(participant, sock.user, store)) ||
      (!isGroup && configManager.isOwner(remoteJid, sock.user, store))
    );

    // Aprendizado dinâmico do JID/LID dos donos no store
    if (isFromOwner && store) {
      let changed = false;
      if (!Array.isArray(store.ownerChatJids)) {
        store.ownerChatJids = [];
        changed = true;
      }
      for (const target of [sender, remoteJid]) {
        if (target && !target.endsWith('@g.us') && !store.ownerChatJids.includes(target)) {
          store.ownerChatJids.push(target);
          changed = true;
        }
      }
      if (changed) {
        storeManager.save();
      }
    }

    // Contexto enriquecido para os handlers e comandos
    const ctx = {
      sock,
      m,
      remoteJid,
      isGroup,
      participant,
      sender,
      senderNum: sender.split('@')[0].split(':')[0].replace(/\D/g, ''),
      isFromOwner,
      fullText,
      prefix: strictPrefix,
      config,
      store,
      configManager,
      storeManager,
      messageStore,

      reply: async (text, extraOptions = {}) => {
        return sock.sendMessage(remoteJid, { text, ...extraOptions }, { quoted: m });
      },

      react: async (emoji) => {
        return sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } });
      }
    };

    // Se NÃO for comando com o prefixo do bot, avalia hooks passivos
    if (!isCommand) {
      if (config.commandsEnabled === false && !isFromOwner) return;

      if (!config.allowPublicCommands && !isFromOwner) {
        for (const hook of passiveHooks) {
          try {
            if (hook.isSecurityHook) {
              const handled = await hook(ctx);
              if (handled === true) return;
            }
          } catch (err) {
            logger.error('HOOK', `Erro no hook de segurança passivo: ${err.message}`);
          }
        }
        return;
      }

      for (const hook of passiveHooks) {
        try {
          const handled = await hook(ctx);
          if (handled === true) return;
        } catch (err) {
          logger.error('HOOK', `Erro no hook passivo: ${err.message}`);
        }
      }
      return;
    }

    // Processamento Estrito do Comando
    const cleanText = fullText.slice(strictPrefix.length).trim();
    if (!cleanText) return;

    const spaceIndex = cleanText.indexOf(' ');
    let commandName = (spaceIndex === -1 ? cleanText : cleanText.slice(0, spaceIndex)).toLowerCase();
    const argText = spaceIndex === -1 ? '' : cleanText.slice(spaceIndex + 1).trim();
    let args = argText ? argText.split(/\s+/) : [];

    // Suporte a comandos colados/juntos de status (ex: statuslista, statislista, stlista)
    const statusJoinedMatch = commandName.match(/^(?:status|statis|st)(lista|todos|selecionados|desativar|bloquear|ativar|liberar|add|del|remover|limpar|off|on)$/i);
    if (statusJoinedMatch && !commands.has(commandName)) {
      const sub = statusJoinedMatch[1].toLowerCase();
      commandName = 'status';
      args = [sub, ...args];
    }

    let resolvedName = aliases.get(commandName) || commandName;
    let cmdDef = commands.get(resolvedName);

    if (!cmdDef && (commandName.startsWith('status') || commandName.startsWith('statis'))) {
      const remainder = commandName.replace(/^(?:status|statis)/i, '');
      if (remainder) {
        resolvedName = 'status';
        cmdDef = commands.get('status');
        args = [remainder, ...args];
      }
    }

    if (!cmdDef) return;

    // Trava Mestre: Comandos Ativados/Desativados
    const isExemptCmd = [
      'bot', 'ativar', 'desativar', 'desligar', 'comandos', 'publico',
      'status', 'st', 'statuslista', 'menu', 'ajuda', 'ping'
    ].includes(resolvedName);

    if (config.commandsEnabled === false && !isExemptCmd) {
      if (isFromOwner) {
        await ctx.reply(
          `⚠️ *Comandos Desativados!*\n\nEnvie \`${strictPrefix}bot on\` para ligar todos os comandos.`
        );
      }
      return;
    }

    // Trava do Público: Se público estiver OFF, responde SOMENTE aos donos
    if (!isFromOwner) {
      if (!config.allowPublicCommands) {
        logger.info('DISPATCHER', `Comando ${strictPrefix}${commandName} ignorado (Público OFF e remetente não é dono: +${ctx.senderNum})`);
        return;
      }
      if (cmdDef.ownerOnly) {
        return;
      }
    }

    // Validação de Escopo (Grupo vs Privado)
    if (cmdDef.groupOnly && !isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em grupos.');
      return;
    }

    if (cmdDef.privateOnly && isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em conversa privada.');
      return;
    }

    ctx.command = commandName;
    ctx.canonicalCommand = resolvedName;
    ctx.args = args;
    ctx.argText = argText;

    logger.info('COMANDO', `${strictPrefix}${commandName} de +${ctx.senderNum} ${isFromOwner ? '[DONO]' : '[PÚBLICO]'}`);

    try {
      await cmdDef.execute(ctx);
    } catch (err) {
      logger.error('COMANDO', `Erro ao executar ${commandName}: ${err.message}`);
      try {
        await ctx.reply(`⚠️ Erro ao processar comando: ${err.message}`);
      } catch {}
    }
  }

  return {
    registerCommand,
    registerPassiveHook,
    handleMessage,
    getCommands: () => Array.from(commands.values())
  };
}
