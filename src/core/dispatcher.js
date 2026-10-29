/**
 * Despachante Central de Mensagens e Comandos
 * - Roteamento ultra-rápido de comandos via Map O(1)
 * - Validação estrita de prefixo ('!' para whatsapp-bot, '.' para status-bot)
 * - Trava mestre de comandos (.bot on/off, .ativar)
 * - Trava de acesso público (.publico on/off): quando público estiver off, responde exclusivamente aos donos
 * - Reconhecimento e aprendizado dinâmico de identificadores dos dois donos (LID e telefone)
 * - Hooks passivos modulares (anti-link, downloads automáticos, apagar mensagem)
 */

import { logger } from './logger.js';

export function createDispatcher(options) {
  const { configManager, storeManager } = options;

  const commands = new Map();
  const aliases = new Map();
  const passiveHooks = [];

  function registerCommand(cmdDef) {
    if (!cmdDef.name || typeof cmdDef.execute !== 'function') {
      throw new Error(`Comando inválido: nome e método execute são obrigatórios`);
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
    const msg = m.message;
    if (!msg) return '';

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

    // 1. Prefixo Estrito (WhatsApp bot: estritamente '!', Status bot: estritamente '.')
    const strictPrefix = config.prefix || '.';
    const isCommand = fullText.startsWith(strictPrefix);

    const isGroup = remoteJid.endsWith('@g.us');
    const participant = m.key.participant || (isGroup ? '' : remoteJid);
    const sender = participant || remoteJid;
    const store = storeManager ? storeManager.get() : null;

    // Reconhecimento dos donos:
    // - Mensagem enviada pelo próprio WhatsApp do bot / Web WhatsApp (m.key.fromMe)
    // - Remetente da mensagem (sender / participant)
    // - Em chat privado (DM), o remoteJid identifica diretamente o usuário
    const isFromOwner = Boolean(
      m.key.fromMe ||
      configManager.isOwner(sender, sock.user, store) ||
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

    // Contexto enriquecido para os handlers
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
      config,
      store,
      configManager,
      storeManager,

      reply: async (text, extraOptions = {}) => {
        return sock.sendMessage(remoteJid, { text, ...extraOptions }, { quoted: m });
      },

      react: async (emoji) => {
        return sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } });
      }
    };

    // 2. Se NÃO for comando com prefixo estrito, avalia hooks passivos apenas se permitido
    if (!isCommand) {
      // Se comandos/bot estiverem desativados e não for dono, não processa hooks passivos
      if (config.commandsEnabled === false && !isFromOwner) return;

      // Se público estiver desativado (público off) e NÃO for dono:
      // O bot NÃO responde a ninguém além dos dois donos.
      // Apenas hooks estritos de moderação/segurança de grupo (como antilink) podem rodar se o grupo estiver protegido.
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

    // 3. Processamento Estrito do Comando
    const cleanText = fullText.slice(strictPrefix.length).trim();
    if (!cleanText) return;

    const spaceIndex = cleanText.indexOf(' ');
    const commandName = (spaceIndex === -1 ? cleanText : cleanText.slice(0, spaceIndex)).toLowerCase();
    const argText = spaceIndex === -1 ? '' : cleanText.slice(spaceIndex + 1).trim();
    const args = argText ? argText.split(/\s+/) : [];

    const resolvedName = aliases.get(commandName) || commandName;
    const cmdDef = commands.get(resolvedName);

    if (!cmdDef) return;

    // 4. Trava Mestre: Comandos Ativados/Desativados
    // Comandos de ativação mestre (.bot, .ativar, .comandos, .publico) são sempre permitidos para o dono
    const isActivationCmd = ['bot', 'ativar', 'desativar', 'comandos', 'publico'].includes(resolvedName);
    if (config.commandsEnabled === false && !isActivationCmd) {
      if (isFromOwner) {
        await ctx.reply(
          `⚠️ *Comandos Desativados!*\n\nEnvie \`${strictPrefix}bot on\` ou \`${strictPrefix}ativar\` para ligar todos os comandos.`
        );
      }
      return;
    }

    // 5. Trava do Público: Se público estiver OFF (allowPublicCommands === false), responde SOMENTE aos dois donos!
    if (!isFromOwner) {
      if (!config.allowPublicCommands) {
        // Se desativado pro público, ignora silenciosamente requisições de outros
        logger.info('DISPATCHER', `Comando ${strictPrefix}${commandName} ignorado (Público OFF e remetente não é dono: +${ctx.senderNum})`);
        return;
      }
      if (cmdDef.ownerOnly) {
        return;
      }
    }

    // 6. Validação de Escopo (Grupo vs Privado)
    if (cmdDef.groupOnly && !isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em grupos.');
      return;
    }

    if (cmdDef.privateOnly && isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em conversa privada.');
      return;
    }

    ctx.prefix = strictPrefix;
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
