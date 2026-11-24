/**
 * Gerenciador de Armazenamento e Cache de Mensagens
 * - Cache LRU em memória para mensagens recentes (permite retentativa e resolução de mídia)
 * - Deserialização e restauração segura de Buffers criptográficos
 */

export function restoreBuffers(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data);
  }
  for (const k of Object.keys(obj)) {
    obj[k] = restoreBuffers(obj[k]);
  }
  return obj;
}

export function createMessageStore(options = {}) {
  const { maxMessages = 2500 } = options;
  const msgCache = new Map();

  function cacheMessage(m) {
    if (!m?.key?.id || !m?.message) return;
    const id = m.key.id;

    if (msgCache.size >= maxMessages) {
      const oldest = msgCache.keys().next().value;
      msgCache.delete(oldest);
    }

    msgCache.set(id, {
      id,
      key: m.key,
      message: m.message,
      receivedAt: m.receivedAt || Date.now()
    });
  }

  function getMessage(id) {
    if (!id) return null;
    const item = msgCache.get(id) || null;
    if (item) restoreBuffers(item);
    return item;
  }

  return {
    cacheMessage,
    getMessage,
    restoreBuffers,
    getGeneralCacheSize: () => msgCache.size
  };
}
