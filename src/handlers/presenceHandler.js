/**
 * Handler Unificado de Presença Fake Contínua (Digitando, Gravando, Online)
 * - Loop periódico seguro de 10s
 * - Suporta modos: 'composing' (digitando), 'recording' (gravando áudio), 'available' (online)
 * - Toggle inteligente (mesmo comando ativa/desativa)
 * - Envio de presence 'paused' ao desativar para limpar o status imediatamente no WhatsApp
 * - Limpeza síncrona em store e config (typingChats e alwaysTypingChats)
 */

import { logger } from '../core/logger.js';

export function createPresenceHandler(options) {
  const { configManager, storeManager } = options;

  const PRESENCE_INTERVAL_MS = 10000;
  let presenceInterval = null;
  let activeSock = null;

  function getTypingChats() {
    const store = storeManager.get();
    const config = configManager.get();

    // Mescla store.typingChats com config.typingChats para compatibilidade total
    const chats = { ...(config.typingChats || {}), ...(store.typingChats || {}) };

    // Se houver chats no array legado alwaysTypingChats, converte
    if (Array.isArray(config.alwaysTypingChats)) {
      for (const jid of config.alwaysTypingChats) {
        if (!chats[jid]) {
          chats[jid] = { mode: 'composing', name: jid.split('@')[0], updatedAt: Date.now() };
        }
      }
    }

    return chats;
  }

  function start(sock) {
    stop();
    if (!sock) return;
    activeSock = sock;

    const tick = async () => {
      if (!activeSock) return;
      const chats = getTypingChats();
      const entries = Object.entries(chats);
      if (entries.length === 0) return;

      for (const [jid, info] of entries) {
        const mode = (typeof info === 'object' ? info?.mode : info) || 'composing';
        try {
          await activeSock.sendPresenceUpdate(mode, jid);
        } catch (err) {
          logger.debug('PRESENÇA', `Falha ao enviar presença (${mode}) para ${jid}: ${err.message}`);
        }
      }
    };

    tick().catch(() => {});
    presenceInterval = setInterval(tick, PRESENCE_INTERVAL_MS);
    const count = Object.keys(getTypingChats()).length;
    logger.info('PRESENÇA', `Loop de presença fake ativo (${count} chats registrados)`);
  }

  function stop() {
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
  }

  async function pausePresence(jid) {
    if (activeSock && jid) {
      try {
        await activeSock.sendPresenceUpdate('paused', jid);
      } catch (err) {
        logger.debug('PRESENÇA', `Erro ao pausar presença em ${jid}: ${err.message}`);
      }
    }
  }

  async function setChatPresence(jid, mode, name = '') {
    const store = storeManager.get();
    if (!store.typingChats) store.typingChats = {};

    store.typingChats[jid] = {
      mode,
      name: name || jid.split('@')[0],
      updatedAt: Date.now()
    };
    storeManager.save();

    // Mantém também no config
    const cfg = configManager.get();
    if (!cfg.typingChats) cfg.typingChats = {};
    cfg.typingChats[jid] = store.typingChats[jid];
    configManager.save();

    if (activeSock) {
      try {
        await activeSock.sendPresenceUpdate(mode, jid);
      } catch {}
    }
    logger.info('PRESENÇA', `Presença ativada para ${jid} (${mode})`);
  }

  async function removeChatPresence(jid) {
    if (!jid) return;

    const store = storeManager.get();
    if (store.typingChats) {
      delete store.typingChats[jid];
    }
    if (Array.isArray(store.alwaysTypingChats)) {
      store.alwaysTypingChats = store.alwaysTypingChats.filter(x => x !== jid);
    }
    storeManager.save();

    const cfg = configManager.get();
    if (cfg.typingChats) {
      delete cfg.typingChats[jid];
    }
    if (Array.isArray(cfg.alwaysTypingChats)) {
      cfg.alwaysTypingChats = cfg.alwaysTypingChats.filter(x => x !== jid);
    }
    configManager.save();

    await pausePresence(jid);
    logger.info('PRESENÇA', `Presença fake desativada para ${jid}`);
  }

  async function resetAll() {
    const chats = getTypingChats();
    const activeJids = Object.keys(chats);

    for (const jid of activeJids) {
      await pausePresence(jid);
    }

    const store = storeManager.get();
    store.typingChats = {};
    store.alwaysTypingChats = [];
    storeManager.save();

    const cfg = configManager.get();
    cfg.typingChats = {};
    cfg.alwaysTypingChats = [];
    configManager.save();

    logger.info('PRESENÇA', `Presença fake resetada em todos os chats (${activeJids.length} limpos)`);
    return activeJids.length;
  }

  return {
    start,
    stop,
    getTypingChats,
    setChatPresence,
    removeChatPresence,
    pausePresence,
    resetAll
  };
}
