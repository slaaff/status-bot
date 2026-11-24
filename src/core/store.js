/**
 * Gerenciador de Armazenamento e Estatísticas Persistentes
 * - Centraliza contadores de status vistos/curtidos, estatísticas, grupos e presença fake
 * - Limita statusViews aos últimos 200 registros para evitar crescimento infinito em disco/RAM
 * - Gravação debounced com flush garantido no encerramento do processo
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const MAX_STORED_STATUS_VIEWS = 200;

export function createStoreManager(customStoragePath = './data/storage.json', legacyStatsPath = './stats.json') {
  const primaryPath = path.resolve(customStoragePath);
  const legacyPath = legacyStatsPath ? path.resolve(legacyStatsPath) : null;

  const defaults = {
    statusViewedCount: 0,
    statusLikedCount: 0,
    statusViewsReceivedCount: 0,
    statusViews: {},
    typingChats: {},
    stickersCreatedCount: 0,
    musicDownloadedCount: 0,
    ownerChatJid: '',
    ownerChatJids: [],
    antilinkGroups: {},
    antifakeGroups: {}
  };

  let storeData = { ...defaults };
  let saveTimer = null;
  let isDirty = false;

  function pruneStatusViews() {
    if (!storeData.statusViews || typeof storeData.statusViews !== 'object') {
      storeData.statusViews = {};
      return false;
    }
    const keys = Object.keys(storeData.statusViews);
    if (keys.length <= MAX_STORED_STATUS_VIEWS) return false;
    const removeCount = keys.length - MAX_STORED_STATUS_VIEWS;
    for (let i = 0; i < removeCount; i++) {
      delete storeData.statusViews[keys[i]];
    }
    return true;
  }

  function load() {
    let loaded = false;

    if (fs.existsSync(primaryPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
        storeData = { ...defaults, ...parsed };
        loaded = true;
      } catch (err) {
        logger.error('STORE', `Erro ao ler ${primaryPath}: ${err.message}`);
      }
    }

    if (legacyPath && fs.existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (typeof legacy.viewed === 'number' && !loaded) storeData.statusViewedCount = legacy.viewed;
        if (typeof legacy.liked === 'number' && !loaded) storeData.statusLikedCount = legacy.liked;
        if (typeof legacy.totalViewsReceived === 'number' && !loaded) storeData.statusViewsReceivedCount = legacy.totalViewsReceived;
        if (legacy.viewsReceived && !loaded) storeData.statusViews = legacy.viewsReceived;
      } catch {}
    }

    if (!storeData.typingChats) storeData.typingChats = {};
    if (!storeData.antilinkGroups) storeData.antilinkGroups = {};
    if (!storeData.antifakeGroups) storeData.antifakeGroups = {};
    if (!Array.isArray(storeData.ownerChatJids)) storeData.ownerChatJids = [];

    if (pruneStatusViews()) {
      isDirty = true;
    }

    return storeData;
  }

  function flush() {
    if (!isDirty && !saveTimer) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    try {
      fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
      fs.writeFileSync(primaryPath, JSON.stringify(storeData, null, 2), 'utf8');

      if (legacyPath) {
        const legacyObj = {
          viewed: storeData.statusViewedCount || 0,
          liked: storeData.statusLikedCount || 0,
          totalViewsReceived: storeData.statusViewsReceivedCount || 0,
          viewsReceived: storeData.statusViews || {}
        };
        fs.writeFileSync(legacyPath, JSON.stringify(legacyObj, null, 2), 'utf8');
      }

      isDirty = false;
    } catch (err) {
      logger.error('STORE', `Erro ao salvar estado persistente: ${err.message}`);
    }
  }

  function save(newFields = null) {
    if (newFields && typeof newFields === 'object') {
      Object.assign(storeData, newFields);
    }
    isDirty = true;

    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush();
      }, 1500);
    }
  }

  process.once('exit', flush);

  load();

  return {
    get: () => storeData,
    save,
    flush,
    reload: load,

    incrementViewed: () => {
      storeData.statusViewedCount = (storeData.statusViewedCount || 0) + 1;
      save();
      return storeData.statusViewedCount;
    },
    incrementLiked: () => {
      storeData.statusLikedCount = (storeData.statusLikedCount || 0) + 1;
      save();
      return storeData.statusLikedCount;
    },
    addStatusViewer: (statusId, viewerJid) => {
      if (!storeData.statusViews) storeData.statusViews = {};
      if (!storeData.statusViews[statusId]) storeData.statusViews[statusId] = [];

      if (!storeData.statusViews[statusId].includes(viewerJid)) {
        storeData.statusViews[statusId].push(viewerJid);
        storeData.statusViewsReceivedCount = (storeData.statusViewsReceivedCount || 0) + 1;
        pruneStatusViews();
        save();
        return true;
      }
      return false;
    }
  };
}
