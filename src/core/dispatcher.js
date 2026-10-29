/**
 * Despachante Modular de Comandos e Eventos de Mensagem
 * Substitui escadas gigantescas de if/else por registro modular limpo,
 * permissões declarativas e contexto padronizado (ctx).
 */

import { logger } from './logger.js';

export function createDispatcher(options) {
  const { configManager, storeManager } = options;

  const commands = new Map();
  const aliases = new Map();
  const passiveHooks = [];

  function registerCommand(cmdDef) {
    if (!cmdDef.name || typeof cmdDef.execute !== 'function') {
      throw new Error(`Comando inválido registrado: ${JSON.stringify(cmdDef)}`);
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

    const isGroup = remoteJid.endsWith('@g.us');
    const participant = m.key.participant || (isGroup ? '' : remoteJid);
    const sender = participant || remoteJid;
    const senderNum = sender.split('@')[0].split(':')[0].replace(/\D/g, '');

    const config = configManager.get();
    const isFromOwner = m.key.fromMe || configManager.isOwner(sender, sock.user);

    const fullText = extractMessageText(m);

    // Contexto enriquecido para os handlers
    const ctx = {
      sock,
      m,
      remoteJid,
      isGroup,
      participant,
      sender,
      senderNum,
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

    // 1. Executa hooks passivos (ex: detecção de links, auto-delete, seguranças de grupo)
    for (const hook of passiveHooks) {
      try {
        const handled = await hook(ctx);
        if (handled === true) return; // Se o hook tratou a mensagem completamente, interrompe
      } catch (err) {
        logger.error('HOOK', `Erro no hook passivo: ${err.message}`, err);
      }
    }

    if (!fullText) return;

    // 2. Verificação de Prefixo
    const primaryPrefix = config.prefix || '.';
    const allowedPrefixes = [primaryPrefix];
    // Aceita tanto '.' quanto '!' para garantir conveniência entre ambos os bots se permitido
    if (primaryPrefix === '.') allowedPrefixes.push('!');
    else if (primaryPrefix === '!') allowedPrefixes.push('.');

    const usedPrefix = allowedPrefixes.find(p => fullText.startsWith(p));
    if (!usedPrefix) return;

    const cleanText = fullText.slice(usedPrefix.length).trim();
    const parts = cleanText.split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);
    const argText = cleanText.slice(commandName.length).trim();

    const resolvedName = aliases.get(commandName) || commandName;
    const cmdDef = commands.get(resolvedName);

    if (!cmdDef) return;

    // 3. Validação de Permissões
    if (cmdDef.ownerOnly && !isFromOwner) {
      if (!isGroup) {
        await ctx.reply('🔒 *Comando restrito:* Apenas o dono do bot pode utilizar este comando.');
      }
      return;
    }

    if (cmdDef.groupOnly && !isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em grupos.');
      return;
    }

    if (cmdDef.privateOnly && isGroup) {
      await ctx.reply('⚠️ Este comando só pode ser utilizado em conversa privada.');
      return;
    }

    // Se for grupo, não for dono e comandos públicos estiverem desativados, ignora
    if (isGroup && !isFromOwner && !config.allowPublicCommands) {
      return;
    }

    // Adiciona parâmetros do comando ao ctx
    ctx.prefix = usedPrefix;
    ctx.command = commandName;
    ctx.canonicalCommand = resolvedName;
    ctx.args = args;
    ctx.argText = argText;

    logger.info('COMANDO', `${usedPrefix}${commandName} de +${senderNum} ${isFromOwner ? '[DONO]' : ''}`);

    try {
      await cmdDef.execute(ctx);
    } catch (err) {
      logger.error('COMANDO', `Erro ao executar ${commandName}: ${err.message}`, err);
      try {
        await ctx.reply(`⚠️ Ocorreu um erro ao processar o comando: ${err.message}`);
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
