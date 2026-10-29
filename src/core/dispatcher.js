/**
 * Despachante Modular e Otimizado de Comandos
 * - Roteamento estrito de prefixo (! para whatsapp-bot, . para status-bot)
 * - Trava mestre de ativação/desativação geral de comandos (.bot on/off / .ativar)
 * - Trava de ativação/desativação pública (.publico on/off)
 * - Execução ultra-rápida e não-bloqueante
 */

import { logger } from './logger.js';

export function createDispatcher(options) {
  const { configManager, storeManager } = options;

  const commands = new Map();
  const aliases = new Map();
  const passiveHooks = [];

  function registerCommand(cmdDef) {
    if (!cmdDef.name || typeof cmdDef.execute !== 'function') {
      throw new Error(`Comando inválido: ${JSON.stringify(cmdDef)}`);
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

    // Clique em botão interativo Baileys
    if (msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const parsed = JSON.parse(msg.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
        if (parsed.id) return parsed.id;
      } catch {}
    }
    if (msg.buttonsResponseMessage?.selectedButtonId) return msg.buttonsResponseMessage.selectedButtonId;
    if (msg.templateButtonReplyMessage?.selectedId) return msg.templateButtonReplyMessage.selectedId;
    if (msg.listResponseMessage?.singleSelectReply?.selectedRowId) return msg.listResponseMessage.singleSelectReply.selectedRowId;

    return (
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.documentMessage?.caption ||
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
    const isFromOwner = m.key.fromMe || configManager.isOwner(sender, sock.user);

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
      store: storeManager.get(),
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
    // Comandos de ativação mestre (.bot, .ativar, .comandos) são sempre permitidos para o dono
    const isActivationCmd = ['bot', 'ativar', 'desativar', 'comandos', 'publico'].includes(resolvedName);
    if (config.commandsEnabled === false && !isActivationCmd) {
      if (isFromOwner) {
        await ctx.reply(
          `⚠️ *Comandos Desativados!*\n\nEnvie \`${strictPrefix}bot on\` ou \`${strictPrefix}ativar\` para ligar todos os comandos.`
        );
      }
      return;
    }

    // 5. Trava do Público: Ativação/Desativação pro público
    if (!isFromOwner) {
      if (!config.allowPublicCommands) {
        // Se desativado pro público, ignora silenciosamente requisições de outros
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
