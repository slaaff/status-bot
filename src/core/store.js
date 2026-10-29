/**
 * Gerenciador de Armazenamento e Estatísticas Persistentes
 * - Centraliza contadores de status vistos/curtidos, estatísticas, grupos e presença fake
 * - Suporta compatibilidade retroativa com stats.json e data/storage.json
 * - Gravação debounced com flush garantido no encerramento do processo
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

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
    antilinkGroups: {},
    antifakeGroups: {}
  };

  let storeData = { ...defaults };
  let saveTimer = null;
  let isDirty = false;

  function load() {
    let loaded = false;

    // 1. Tenta carregar do arquivo principal (data/storage.json)
    if (fs.existsSync(primaryPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
        storeData = { ...defaults, ...parsed };
        loaded = true;
      } catch (err) {
        logger.error('STORE', `Erro ao ler ${primaryPath}: ${err.message}`);
      }
    }

    // 2. Se não carregou do principal ou se legacyStatsPath existe (status-bot), mescla stats.json
    if (legacyPath && fs.existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (typeof legacy.viewed === 'number' && !loaded) storeData.statusViewedCount = legacy.viewed;
        if (typeof legacy.liked === 'number' && !loaded) storeData.statusLikedCount = legacy.liked;
        if (typeof legacy.totalViewsReceived === 'number' && !loaded) storeData.statusViewsReceivedCount = legacy.totalViewsReceived;
        if (legacy.viewsReceived && !loaded) storeData.statusViews = legacy.viewsReceived;
      } catch {}
    }

    if (!storeData.statusViews) storeData.statusViews = {};
    if (!storeData.typingChats) storeData.typingChats = {};
    if (!storeData.antilinkGroups) storeData.antilinkGroups = {};
    if (!storeData.antifakeGroups) storeData.antifakeGroups = {};

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

      // Se legacyPath foi fornecido, mantém espelhado para retrocompatibilidade
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

  process.on('exit', flush);
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });

  load();

  return {
    get: () => storeData,
    save,
    flush,
    reload: load,

    // Helpers diretos
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
        save();
        return true;
      }
      return false;
    }
  };
}
