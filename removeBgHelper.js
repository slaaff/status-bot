import { Client, handle_file } from '@gradio/client';

/**
 * Remove o fundo de uma imagem usando modelos de IA (BRIA RMBG 2.0 / 1.4)
 * Rodando na nuvem sem consumir CPU/RAM da VPS.
 * 
 * @param {Buffer} imageBuffer - Buffer da imagem (JPEG/PNG/WebP)
 * @returns {Promise<Buffer>} - Buffer do PNG transparente resultante
 */
export async function removeBackground(imageBuffer) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Buffer de imagem inválido');
  }

  const blob = new Blob([imageBuffer], { type: 'image/png' });

  // 1. Tentar BRIA RMBG 2.0 (modelo mais recente e ultrarrápido)
  try {
    const app = await Client.connect('briaai/BRIA-RMBG-2.0', {
      events: ['data', 'status']
    });
    const res = await Promise.race([
      app.predict('/image', [handle_file(blob)]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout BRIA 2.0')), 20000))
    ]);

    const fileData = res.data?.[1] || res.data?.[0];
    const url = fileData?.url;
    if (url) {
      const response = await fetch(url);
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    }
  } catch (err) {
    console.warn('[REMOVE-BG] Falha no BRIA 2.0, tentando fallback BRIA 1.4:', err?.message || err);
  }

  // 2. Fallback para BRIA RMBG 1.4
  try {
    const app = await Client.connect('briaai/BRIA-RMBG-1.4', {
      events: ['data', 'status']
    });
    const res = await Promise.race([
      app.predict('/run', [handle_file(blob)]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout BRIA 1.4')), 25000))
    ]);

    const fileData = res.data?.[1] || res.data?.[0];
    const url = fileData?.url;
    if (url) {
      const response = await fetch(url);
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    }
  } catch (err) {
    console.error('[REMOVE-BG] Falha no BRIA 1.4:', err?.message || err);
    throw new Error('Servidores de IA para remoção de fundo ocupados ou indisponíveis no momento. Tente novamente em instantes.');
  }

  throw new Error('Não foi possível obter imagem sem fundo dos servidores.');
}
