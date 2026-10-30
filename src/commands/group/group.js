/**
 * Comandos de Gerenciamento e Moderação de Grupos
 * .hidetag, .marcar, .infogp, .link, .abrir, .fechar, .ban, .promover, .rebaixar, .antilink, .antifake
 */

import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { logger } from '../../core/logger.js';

/**
 * Desempacota invólucros do Baileys (ephemeral, viewOnce, etc.)
 */
function unwrapMessage(msg) {
  if (!msg) return null;
  let unwrapped = msg;
  while (
    unwrapped?.ephemeralMessage?.message ||
    unwrapped?.viewOnceMessage?.message ||
    unwrapped?.viewOnceMessageV2?.message ||
    unwrapped?.viewOnceMessageV2Extension?.message ||
    unwrapped?.documentWithCaptionMessage?.message
  ) {
    unwrapped =
      unwrapped?.ephemeralMessage?.message ||
      unwrapped?.viewOnceMessage?.message ||
      unwrapped?.viewOnceMessageV2?.message ||
      unwrapped?.viewOnceMessageV2Extension?.message ||
      unwrapped?.documentWithCaptionMessage?.message;
  }
  return unwrapped;
}

/**
 * Obtém a mensagem citada (quotedMessage) desempacotada
 */
function getQuotedMessage(msg) {
  const unwrapped = unwrapMessage(msg);
  if (!unwrapped) return null;

  const contextInfo =
    unwrapped.extendedTextMessage?.contextInfo ||
    unwrapped.imageMessage?.contextInfo ||
    unwrapped.videoMessage?.contextInfo ||
    unwrapped.stickerMessage?.contextInfo ||
    unwrapped.audioMessage?.contextInfo ||
    unwrapped.documentMessage?.contextInfo ||
    null;

  if (!contextInfo?.quotedMessage) return null;
  return unwrapMessage(contextInfo.quotedMessage);
}

/**
 * Extrai informações e dados de mídia
 */
function getMediaDetails(msg) {
  const unwrapped = unwrapMessage(msg);
  if (!unwrapped) return null;

  if (unwrapped.imageMessage) {
    return {
      type: 'image',
      media: unwrapped.imageMessage,
      caption: unwrapped.imageMessage.caption || ''
    };
  }
  if (unwrapped.videoMessage) {
    return {
      type: 'video',
      media: unwrapped.videoMessage,
      caption: unwrapped.videoMessage.caption || '',
      gifPlayback: Boolean(unwrapped.videoMessage.gifPlayback)
    };
  }
  if (unwrapped.stickerMessage) {
    return {
      type: 'sticker',
      media: unwrapped.stickerMessage
    };
  }
  if (unwrapped.audioMessage) {
    return {
      type: 'audio',
      media: unwrapped.audioMessage,
      mimetype: unwrapped.audioMessage.mimetype || 'audio/mp4',
      ptt: Boolean(unwrapped.audioMessage.ptt)
    };
  }
  if (unwrapped.documentMessage) {
    return {
      type: 'document',
      media: unwrapped.documentMessage,
      caption: unwrapped.documentMessage.caption || '',
      fileName: unwrapped.documentMessage.fileName || 'arquivo',
      mimetype: unwrapped.documentMessage.mimetype || 'application/octet-stream'
    };
  }
  return null;
}

/**
 * Extrai o texto contido na mensagem
 */
function getMessageText(msg) {
  const unwrapped = unwrapMessage(msg);
  if (!unwrapped) return '';

  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.documentMessage?.caption ||
    ''
  ).trim();
}

/**
 * Baixa os bytes da mídia do Baileys
 */
async function downloadMediaBuffer(mediaObj) {
  const typeMap = {
    image: 'image',
    video: 'video',
    sticker: 'sticker',
    audio: 'audio',
    document: 'document'
  };
  const stream = await downloadContentFromMessage(mediaObj.media, typeMap[mediaObj.type] || mediaObj.type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}

export function registerGroupCommands(dispatcher) {
  // 1. .hidetag [frase / citando mensagem]
  dispatcher.registerCommand({
    name: 'hidetag',
    aliases: ['totag', 'ht', 'tagall', 'tag', 'hide'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Menciona todos os membros de forma invisível ou com mídia/texto citado',
    execute: async (ctx) => {
      const { sock, remoteJid, m, argText } = ctx;

      // Obter membros do grupo
      let participants = [];
      try {
        const groupMetadata = await sock.groupMetadata(remoteJid);
        participants = Array.from(new Set(
          (groupMetadata?.participants || [])
            .map(p => p.id || p.jid)
            .filter(Boolean)
        ));
      } catch (err) {
        logger.error('HIDETAG', `Erro ao buscar membros do grupo: ${err.message}`);
        await ctx.reply('⚠️ Falha ao carregar a lista de membros do grupo.');
        return;
      }

      if (!participants.length) {
        await ctx.reply('⚠️ Nenhum membro encontrado no grupo.');
        return;
      }

      const rawMsg = unwrapMessage(m.message);
      const quotedMsg = getQuotedMessage(rawMsg);

      // CASO 1: Foi citada/marcada uma mensagem existente
      if (quotedMsg) {
        const quotedMedia = getMediaDetails(quotedMsg);

        if (quotedMedia) {
          try {
            const buffer = await downloadMediaBuffer(quotedMedia);
            // Se o usuário digitou uma frase junto com o comando (ex: !hidetag veja isso), usa ela; senão usa a legenda original
            const caption = argText || quotedMedia.caption || '';

            if (quotedMedia.type === 'image') {
              await sock.sendMessage(remoteJid, {
                image: buffer,
                caption: caption || undefined,
                mentions: participants
              });
            } else if (quotedMedia.type === 'video') {
              await sock.sendMessage(remoteJid, {
                video: buffer,
                caption: caption || undefined,
                gifPlayback: quotedMedia.gifPlayback,
                mentions: participants
              });
            } else if (quotedMedia.type === 'sticker') {
              await sock.sendMessage(remoteJid, {
                sticker: buffer,
                mentions: participants
              });
            } else if (quotedMedia.type === 'audio') {
              await sock.sendMessage(remoteJid, {
                audio: buffer,
                mimetype: quotedMedia.mimetype,
                ptt: quotedMedia.ptt,
                mentions: participants
              });
            } else if (quotedMedia.type === 'document') {
              await sock.sendMessage(remoteJid, {
                document: buffer,
                fileName: quotedMedia.fileName,
                mimetype: quotedMedia.mimetype,
                caption: caption || undefined,
                mentions: participants
              });
            }

            try {
              await sock.sendMessage(remoteJid, { delete: m.key });
            } catch {}
            return;
          } catch (err) {
            logger.error('HIDETAG', `Erro ao reenviar mídia citada: ${err.message}`);
            const fallbackText = argText || quotedMedia.caption || '📢 Atenção a todos!';
            await sock.sendMessage(remoteJid, { text: fallbackText, mentions: participants });
            try { await sock.sendMessage(remoteJid, { delete: m.key }); } catch {}
            return;
          }
        }

        // Mensagem citada é de texto puro
        const quotedText = getMessageText(quotedMsg);
        const textToSend = argText
          ? (quotedText ? `${argText}\n\n${quotedText}` : argText)
          : (quotedText || '📢 Atenção a todos!');

        await sock.sendMessage(remoteJid, { text: textToSend, mentions: participants });
        try {
          await sock.sendMessage(remoteJid, { delete: m.key });
        } catch {}
        return;
      }

      // CASO 2: Mensagem atual enviada com mídia anexada diretamente e comando na legenda
      const currentMedia = getMediaDetails(rawMsg);
      if (currentMedia) {
        try {
          const buffer = await downloadMediaBuffer(currentMedia);
          const caption = argText || currentMedia.caption || '';

          if (currentMedia.type === 'image') {
            await sock.sendMessage(remoteJid, {
              image: buffer,
              caption: caption || undefined,
              mentions: participants
            });
          } else if (currentMedia.type === 'video') {
            await sock.sendMessage(remoteJid, {
              video: buffer,
              caption: caption || undefined,
              gifPlayback: currentMedia.gifPlayback,
              mentions: participants
            });
          } else if (currentMedia.type === 'sticker') {
            await sock.sendMessage(remoteJid, {
              sticker: buffer,
              mentions: participants
            });
          } else if (currentMedia.type === 'audio') {
            await sock.sendMessage(remoteJid, {
              audio: buffer,
              mimetype: currentMedia.mimetype,
              ptt: currentMedia.ptt,
              mentions: participants
            });
          } else if (currentMedia.type === 'document') {
            await sock.sendMessage(remoteJid, {
              document: buffer,
              fileName: currentMedia.fileName,
              mimetype: currentMedia.mimetype,
              caption: caption || undefined,
              mentions: participants
            });
          }

          try {
            await sock.sendMessage(remoteJid, { delete: m.key });
          } catch {}
          return;
        } catch (err) {
          logger.error('HIDETAG', `Erro ao enviar mídia direta: ${err.message}`);
        }
      }

      // CASO 3: Comando direto sem citação de mensagem (ex: .hidetag <frase> ou só .hidetag)
      const textToSend = argText || '📢 Atenção a todos!';
      await sock.sendMessage(remoteJid, { text: textToSend, mentions: participants });
      try {
        await sock.sendMessage(remoteJid, { delete: m.key });
      } catch {}
    }
  });

  // 2. .marcar <texto>
  dispatcher.registerCommand({
    name: 'marcar',
    aliases: ['m'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Marca todos os membros com lista visível no chat',
    execute: async (ctx) => {
      const { sock, remoteJid, m, argText } = ctx;
      const groupMetadata = await sock.groupMetadata(remoteJid);
      const participants = groupMetadata.participants.map(p => p.id);

      let tagMsg = `📢 *TODOS OS MEMBROS*\n👥 *Grupo:* ${groupMetadata.subject}\n`;
      if (argText) tagMsg += `💬 *Recado:* ${argText}\n`;
      tagMsg += `━━━━━━━━━━━━━━━━━━━━\n`;

      for (const p of groupMetadata.participants) {
        tagMsg += `• @${p.id.split('@')[0]}\n`;
      }

      await sock.sendMessage(remoteJid, { text: tagMsg, mentions: participants }, { quoted: m });
    }
  });

  // 3. .infogp
  dispatcher.registerCommand({
    name: 'infogp',
    aliases: ['i', 'ig', 'infogrupo'],
    groupOnly: true,
    description: 'Exibe informações e estatísticas do grupo',
    execute: async (ctx) => {
      const groupMetadata = await ctx.sock.groupMetadata(ctx.remoteJid);
      const admins = groupMetadata.participants.filter(p => p.admin || p.isAdmin);
      const criador = groupMetadata.owner ? `@${groupMetadata.owner.split('@')[0]}` : 'Desconhecido';

      const infoTxt = `📋 *DADOS DO GRUPO*
📌 *Nome:* ${groupMetadata.subject}
👑 *Criador:* ${criador}
👥 *Membros:* ${groupMetadata.participants.length}
🛡️ *Admins:* ${admins.length}
🔒 *Apenas admins falam:* ${groupMetadata.announce ? 'Sim' : 'Não'}
📝 *Descrição:*
${groupMetadata.desc || 'Sem descrição.'}`;

      await ctx.reply(infoTxt, { mentions: groupMetadata.owner ? [groupMetadata.owner] : [] });
    }
  });

  // 4. .link
  dispatcher.registerCommand({
    name: 'link',
    aliases: ['linkgp', 'l'],
    groupOnly: true,
    description: 'Obtém o link de convite do grupo',
    execute: async (ctx) => {
      try {
        const code = await ctx.sock.groupInviteCode(ctx.remoteJid);
        await ctx.reply(`🔗 *Link do Grupo:*\nhttps://chat.whatsapp.com/${code}`);
      } catch {
        await ctx.reply('⚠️ O bot precisa ser *administrador* para obter o link de convite.');
      }
    }
  });

  // 5. .abrir / .fechar
  dispatcher.registerCommand({
    name: 'abrir',
    aliases: ['a'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Abre o grupo permitindo que todos enviem mensagens',
    execute: async (ctx) => {
      try {
        await ctx.sock.groupSettingUpdate(ctx.remoteJid, 'not_announcement');
        await ctx.reply('🔓 *Grupo Aberto!* Todos podem enviar mensagens.');
      } catch {
        await ctx.reply('⚠️ O bot precisa ser administrador.');
      }
    }
  });

  dispatcher.registerCommand({
    name: 'fechar',
    aliases: ['f'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Fecha o grupo para que apenas administradores enviem mensagens',
    execute: async (ctx) => {
      try {
        await ctx.sock.groupSettingUpdate(ctx.remoteJid, 'announcement');
        await ctx.reply('🔒 *Grupo Fechado!* Apenas admins podem enviar mensagens.');
      } catch {
        await ctx.reply('⚠️ O bot precisa ser administrador.');
      }
    }
  });

  // 6. .ban @membro
  dispatcher.registerCommand({
    name: 'ban',
    aliases: ['b', 'kick'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Remove um membro do grupo',
    execute: async (ctx) => {
      let targetJid = null;
      const quoted = ctx.m.message?.extendedTextMessage?.contextInfo;
      if (quoted?.participant) targetJid = quoted.participant;
      else if (quoted?.mentionedJid?.[0]) targetJid = quoted.mentionedJid[0];
      else if (ctx.args[0]) {
        const cleanNum = ctx.args[0].replace(/\D/g, '');
        if (cleanNum.length >= 8) targetJid = `${cleanNum}@s.whatsapp.net`;
      }

      if (!targetJid) {
        await ctx.reply(`⚠️ Responda à mensagem ou use \`${ctx.prefix}ban @membro\``);
        return;
      }

      try {
        await ctx.sock.groupParticipantsUpdate(ctx.remoteJid, [targetJid], 'remove');
        await ctx.reply('👋 Membro removido com sucesso.');
      } catch (err) {
        await ctx.reply(`⚠️ Falha ao remover membro: ${err.message}`);
      }
    }
  });

  // 7. .promover / .rebaixar
  dispatcher.registerCommand({
    name: 'promover',
    aliases: ['pr'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Promove um membro a administrador',
    execute: async (ctx) => {
      let targetJid = ctx.m.message?.extendedTextMessage?.contextInfo?.participant ||
                      ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!targetJid && ctx.args[0]) {
        const clean = ctx.args[0].replace(/\D/g, '');
        if (clean.length >= 8) targetJid = `${clean}@s.whatsapp.net`;
      }
      if (!targetJid) {
        await ctx.reply(`⚠️ Marque alguém ou responda à mensagem com \`${ctx.prefix}promover\``);
        return;
      }

      try {
        await ctx.sock.groupParticipantsUpdate(ctx.remoteJid, [targetJid], 'promote');
        await ctx.reply('👑 Membro promovido a administrador!');
      } catch (err) {
        await ctx.reply(`⚠️ Erro: ${err.message}`);
      }
    }
  });

  dispatcher.registerCommand({
    name: 'rebaixar',
    aliases: ['r'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Rebaixa um administrador para membro comum',
    execute: async (ctx) => {
      let targetJid = ctx.m.message?.extendedTextMessage?.contextInfo?.participant ||
                      ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!targetJid && ctx.args[0]) {
        const clean = ctx.args[0].replace(/\D/g, '');
        if (clean.length >= 8) targetJid = `${clean}@s.whatsapp.net`;
      }
      if (!targetJid) {
        await ctx.reply(`⚠️ Marque alguém ou responda à mensagem com \`${ctx.prefix}rebaixar\``);
        return;
      }

      try {
        await ctx.sock.groupParticipantsUpdate(ctx.remoteJid, [targetJid], 'demote');
        await ctx.reply('👤 Administrador rebaixado para membro comum.');
      } catch (err) {
        await ctx.reply(`⚠️ Erro: ${err.message}`);
      }
    }
  });

  // 8. .antilink [on/off]
  dispatcher.registerCommand({
    name: 'antilink',
    aliases: ['al'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Ativa ou desativa a remoção automática de links de grupos',
    execute: async (ctx) => {
      const store = ctx.store;
      if (!store.antilinkGroups) store.antilinkGroups = {};
      const opt = (ctx.args[0] || '').toLowerCase();

      if (['on', '1', 'ativar', 'sim', 'true'].includes(opt)) {
        store.antilinkGroups[ctx.remoteJid] = true;
      } else if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) {
        delete store.antilinkGroups[ctx.remoteJid];
      } else {
        if (store.antilinkGroups[ctx.remoteJid]) {
          delete store.antilinkGroups[ctx.remoteJid];
        } else {
          store.antilinkGroups[ctx.remoteJid] = true;
        }
      }
      ctx.storeManager.save();

      const isAtivo = Boolean(store.antilinkGroups[ctx.remoteJid]);
      await ctx.reply(
        `🛡️ *Antilink:* ${isAtivo ? 'ATIVADO ✅ (Links de outros grupos serão apagados automaticamente)' : 'DESATIVADO ❌'}`
      );
    }
  });

  // 9. .antifake [on/off]
  dispatcher.registerCommand({
    name: 'antifake',
    aliases: ['af'],
    groupOnly: true,
    ownerOnly: true,
    description: 'Ativa ou desativa a expulsão automática de números estrangeiros (sem +55)',
    execute: async (ctx) => {
      const store = ctx.store;
      if (!store.antifakeGroups) store.antifakeGroups = {};
      const opt = (ctx.args[0] || '').toLowerCase();

      if (['on', '1', 'ativar', 'sim', 'true'].includes(opt)) {
        store.antifakeGroups[ctx.remoteJid] = true;
      } else if (['off', '0', 'desativar', 'nao', 'não', 'false'].includes(opt)) {
        delete store.antifakeGroups[ctx.remoteJid];
      } else {
        if (store.antifakeGroups[ctx.remoteJid]) {
          delete store.antifakeGroups[ctx.remoteJid];
        } else {
          store.antifakeGroups[ctx.remoteJid] = true;
        }
      }
      ctx.storeManager.save();

      const isAtivo = Boolean(store.antifakeGroups[ctx.remoteJid]);
      await ctx.reply(
        `🛡️ *Antifake:* ${isAtivo ? 'ATIVADO ✅ (Números estrangeiros sem +55 serão removidos)' : 'DESATIVADO ❌'}`
      );
    }
  });
}