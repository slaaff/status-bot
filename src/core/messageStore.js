/**
 * Gerenciador de Armazenamento e Cache de Mensagens
 * - Cache LRU com expiração automática por idade para evitar consumo excessivo de RAM
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
  const { maxMessages = 600, maxAgeMs = 30 * 60 * 1000 } = options;
  const msgCache = new Map();

  function prune(now = Date.now()) {
    for (const [id, item] of msgCache) {
      if (now - item.receivedAt > maxAgeMs) {
        msgCache.delete(id);
      } else {
        break;
      }
    }
  }

  function cacheMessage(m) {
    if (!m?.key?.id || !m?.message) return;
    const id = m.key.id;
    const now = m.receivedAt || Date.now();

    if (msgCache.has(id)) {
      msgCache.delete(id);
    } else if (msgCache.size >= maxMessages) {
      prune(now);
      if (msgCache.size >= maxMessages) {
        const oldest = msgCache.keys().next().value;
        msgCache.delete(oldest);
      }
    }

    msgCache.set(id, {
      id,
      key: m.key,
      message: m.message,
      receivedAt: now
    });
  }

  function getMessage(id) {
    if (!id) return null;
    const item = msgCache.get(id) || null;
    if (!item) return null;
    if (Date.now() - item.receivedAt > maxAgeMs) {
      msgCache.delete(id);
      return null;
    }
    restoreBuffers(item);
    return item;
  }

  return {
    cacheMessage,
    getMessage,
    prune,
    restoreBuffers,
    getGeneralCacheSize: () => msgCache.size
  };
}
