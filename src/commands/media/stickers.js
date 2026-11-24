/**
 * Comandos de Figurinhas & Stickers
 * - .s / !s : Converte foto/vídeo/gif em figurinha
 * - .sf / !sf : Cria figurinha sem fundo (remove background via IA)
 * - .toimg / !toimg : Converte figurinha em foto comum
 */

import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { createSticker, stickerToImage } from '../../../stickerHelper.js';
import { removeBackground } from '../../../removeBgHelper.js';
import { logger } from '../../core/logger.js';

export function extractMediaInfo(m) {
  let msg = m.message;
  if (!msg) return null;

  if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
  if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;

  if (msg.imageMessage) return { type: 'image', media: msg.imageMessage, isVideo: false };
  if (msg.videoMessage) return { type: 'video', media: msg.videoMessage, isVideo: true, seconds: msg.videoMessage.seconds || 0 };
  if (msg.stickerMessage) return { type: 'sticker', media: msg.stickerMessage, isVideo: false };
  if (msg.documentMessage && (msg.documentMessage.mimetype?.startsWith('image/') || msg.documentMessage.mimetype?.startsWith('video/'))) {
    const isVid = msg.documentMessage.mimetype.startsWith('video/');
    return { type: isVid ? 'video' : 'image', media: msg.documentMessage, isVideo: isVid, seconds: msg.documentMessage.seconds || 0 };
  }

  let quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    if (quoted.ephemeralMessage?.message) quoted = quoted.ephemeralMessage.message;
    if (quoted.viewOnceMessage?.message) quoted = quoted.viewOnceMessage.message;
    if (quoted.viewOnceMessageV2?.message) quoted = quoted.viewOnceMessageV2.message;
    if (quoted.viewOnceMessageV2Extension?.message) quoted = quoted.viewOnceMessageV2Extension.message;
    if (quoted.documentWithCaptionMessage?.message) quoted = quoted.documentWithCaptionMessage.message;

    if (quoted.imageMessage) return { type: 'image', media: quoted.imageMessage, isVideo: false };
    if (quoted.videoMessage) return { type: 'video', media: quoted.videoMessage, isVideo: true, seconds: quoted.videoMessage.seconds || 0 };
    if (quoted.stickerMessage) return { type: 'sticker', media: quoted.stickerMessage, isVideo: false };
    if (quoted.documentMessage && (quoted.documentMessage.mimetype?.startsWith('image/') || quoted.documentMessage.mimetype?.startsWith('video/'))) {
      const isVid = quoted.documentMessage.mimetype.startsWith('video/');
      return { type: isVid ? 'video' : 'image', media: quoted.documentMessage, isVideo: isVid, seconds: quoted.documentMessage.seconds || 0 };
    }
  }

  return null;
}

export async function downloadMediaBuffer(mediaObj) {
  const stream = await downloadContentFromMessage(
    mediaObj.media,
    mediaObj.type === 'sticker' ? 'sticker' : (mediaObj.type === 'document' ? 'document' : (mediaObj.type === 'audio' ? 'audio' : mediaObj.type))
  );

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function registerStickerCommands(dispatcher) {
  // 1. .s / .figurinha (Sticker Normal de Imagem ou Vídeo)
  dispatcher.registerCommand({
    name: 's',
    aliases: ['figurinha', 'sticker'],
    description: 'Converte imagem, vídeo ou gif em figurinha',
    execute: async (ctx) => {
      const mediaInfo = extractMediaInfo(ctx.m);
      if (!mediaInfo || (mediaInfo.type !== 'image' && mediaInfo.type !== 'video')) {
        await ctx.reply(`⚠️ Envie ou marque uma imagem/vídeo com \`${ctx.prefix}s\``);
        return;
      }

      if (mediaInfo.isVideo && mediaInfo.seconds > 10) {
        await ctx.reply('⚠️ Vídeos para figurinha devem ter no máximo 10 segundos!');
        return;
      }

      await ctx.react('⏳');

      let rawBuffer = null;
      let stickerBuffer = null;

      try {
        rawBuffer = await downloadMediaBuffer(mediaInfo);
        const pack = ctx.config.stickerPack || 'Meu Assistente';
        const author = ctx.config.stickerAuthor || 'Bot WhatsApp';

        stickerBuffer = await createSticker(rawBuffer, mediaInfo.isVideo, pack, author);
        rawBuffer = null;

        await ctx.sock.sendMessage(ctx.remoteJid, { sticker: stickerBuffer }, { quoted: ctx.m });
        stickerBuffer = null;

        if (ctx.store) {
          ctx.store.stickersCreatedCount = (ctx.store.stickersCreatedCount || 0) + 1;
          if (ctx.storeManager?.save) ctx.storeManager.save();
        }

        await ctx.react('✅');
      } catch (err) {
        logger.error('STICKER', 'Erro ao criar figurinha', err);
        await ctx.react('❌');
        await ctx.reply(`❌ Erro ao criar figurinha: ${err.message}`);
      } finally {
        rawBuffer = null;
        stickerBuffer = null;
        if (typeof global.gc === 'function') {
          setImmediate(() => { try { global.gc(); } catch {} });
        }
      }
    }
  });

  // 2. .sf / .semfundo (Figurinha Sem Fundo / Remove Background via IA)
  dispatcher.registerCommand({
    name: 'sf',
    aliases: ['semfundo', 'nobg', 'sbg', 'figsemfundo'],
    description: 'Cria figurinha sem fundo removendo o background por IA',
    execute: async (ctx) => {
      const mediaInfo = extractMediaInfo(ctx.m);
      if (!mediaInfo || (mediaInfo.type !== 'image' && mediaInfo.type !== 'sticker')) {
        await ctx.reply(
          `⚠️ *Como usar figurinha sem fundo:*\n\n` +
          `• Envie uma foto ou responda a uma foto com \`${ctx.prefix}sf\`\n` +
          `• Ou responda a uma figurinha já existente com \`${ctx.prefix}sf\` para retirar o fundo dela!`
        );
        return;
      }

      if (mediaInfo.isVideo) {
        await ctx.reply('⚠️ Remoção de fundo funciona apenas com fotos ou figurinhas estáticas.');
        return;
      }

      await ctx.react('⏳');

      let rawBuffer = null;
      let noBgBuffer = null;
      let stickerBuffer = null;

      try {
        rawBuffer = await downloadMediaBuffer(mediaInfo);

        // Se o usuário marcou uma figurinha já existente, converte para imagem antes de tirar o fundo
        if (mediaInfo.type === 'sticker') {
          rawBuffer = await stickerToImage(rawBuffer);
        }

        // Remove o fundo com IA na nuvem (zero carga na VPS)
        noBgBuffer = await removeBackground(rawBuffer);
        rawBuffer = null;

        const pack = ctx.config.stickerPack || 'Meu Assistente';
        const author = ctx.config.stickerAuthor || 'Bot WhatsApp';

        // Gera figurinha WebP preservando a transparência RGBA
        stickerBuffer = await createSticker(noBgBuffer, false, pack, author);
        noBgBuffer = null;

        await ctx.sock.sendMessage(ctx.remoteJid, { sticker: stickerBuffer }, { quoted: ctx.m });
        stickerBuffer = null;

        if (ctx.store) {
          ctx.store.stickersCreatedCount = (ctx.store.stickersCreatedCount || 0) + 1;
          if (ctx.storeManager?.save) ctx.storeManager.save();
        }

        await ctx.react('✅');
      } catch (err) {
        logger.error('REMOVE_BG', 'Erro ao criar figurinha sem fundo', err);
        await ctx.react('❌');
        await ctx.reply(`❌ Erro ao remover fundo: ${err.message || 'Falha no processamento da imagem.'}`);
      } finally {
        rawBuffer = null;
        noBgBuffer = null;
        stickerBuffer = null;
        if (typeof global.gc === 'function') {
          setImmediate(() => { try { global.gc(); } catch {} });
        }
      }
    }
  });

  // 3. .toimg / .foto (Converte figurinha em foto)
  dispatcher.registerCommand({
    name: 'toimg',
    aliases: ['foto', 'imagem'],
    description: 'Converte uma figurinha em foto comum',
    execute: async (ctx) => {
      const mediaInfo = extractMediaInfo(ctx.m);
      if (!mediaInfo || mediaInfo.type !== 'sticker') {
        await ctx.reply(`⚠️ Marque uma figurinha estática com \`${ctx.prefix}toimg\``);
        return;
      }

      await ctx.react('⏳');

      let rawBuffer = null;
      let imgBuffer = null;

      try {
        rawBuffer = await downloadMediaBuffer(mediaInfo);
        imgBuffer = await stickerToImage(rawBuffer);
        rawBuffer = null;

        await ctx.sock.sendMessage(ctx.remoteJid, { image: imgBuffer }, { quoted: ctx.m });
        imgBuffer = null;
        await ctx.react('✅');
      } catch (err) {
        logger.error('TOIMG', 'Erro ao converter figurinha em imagem', err);
        await ctx.react('❌');
        await ctx.reply(`❌ Erro ao converter figurinha: ${err.message}`);
      } finally {
        rawBuffer = null;
        imgBuffer = null;
        if (typeof global.gc === 'function') {
          setImmediate(() => { try { global.gc(); } catch {} });
        }
      }
    }
  });
}
