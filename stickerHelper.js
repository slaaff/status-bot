import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import webpmux from 'node-webpmux';

const execFilePromise = util.promisify(execFile);

/**
 * Converte imagem ou vídeo/gif para figurinha WebP compatível com WhatsApp (512x512)
 * e adiciona metadados EXIF (Pack e Author).
 */
export async function createSticker(mediaBuffer, isVideo = false, pack = 'Meu Assistente', author = 'WhatsApp') {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(7);
  const isPng = !isVideo && mediaBuffer && mediaBuffer[0] === 0x89 && mediaBuffer[1] === 0x50;
  const inputExt = isVideo ? 'mp4' : (isPng ? 'png' : 'jpg');
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `temp_media_${tempId}.${inputExt}`);
  const outputPath = path.join(tmpDir, `temp_media_${tempId}.webp`);

  try {
    await fs.promises.writeFile(inputPath, mediaBuffer);

    let ffmpegArgs = [];
    if (isVideo) {
      ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-ss', '00:00:00',
        '-t', '00:00:07',
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
        '-vcodec', 'libwebp',
        '-preset', 'default',
        '-loop', '0',
        '-an',
        '-vsync', '0',
        '-s', '512x512',
        outputPath
      ];
    } else {
      ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
        '-vcodec', 'libwebp',
        outputPath
      ];
    }

    await execFilePromise('ffmpeg', ffmpegArgs);
    const webpBuffer = await fs.promises.readFile(outputPath);

    // Injetar metadados EXIF no WebP
    try {
      const img = new webpmux.Image();
      await img.load(webpBuffer);
      const json = {
        'sticker-pack-id': 'https://github.com/slaaff/whatsapp-bot',
        'sticker-pack-name': pack,
        'sticker-pack-publisher': author,
        'emojis': ['🤖', '✨']
      };
      const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
      const exif = Buffer.concat([exifAttr, jsonBuff]);
      exif.writeUIntLE(jsonBuff.length, 14, 4);
      img.exif = exif;
      return await img.save(null);
    } catch {
      return webpBuffer;
    }
  } finally {
    if (fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath); } catch {}
    }
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  }
}

/**
 * Converte uma figurinha WebP para imagem PNG/JPG
 */
export async function stickerToImage(stickerBuffer) {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(7);
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `temp_stk_${tempId}.webp`);
  const outputPath = path.join(tmpDir, `temp_img_${tempId}.png`);

  try {
    await fs.promises.writeFile(inputPath, stickerBuffer);
    await execFilePromise('ffmpeg', ['-y', '-i', inputPath, outputPath]);
    return await fs.promises.readFile(outputPath);
  } finally {
    if (fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath); } catch {}
    }
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  }
}
