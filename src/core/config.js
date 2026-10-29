/**
 * Gerenciador centralizado de configurações
 * - Carregamento seguro com valores padrão
 * - Gravação debounced com flush garantido no encerramento do processo
 * - Cache de telefones normalizados para latência ultra-baixa
 * - Sincronização automática entre modos de status (mode <-> autoViewStatus/autoLikeStatus)
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export function createConfigManager(customConfigPath = './config.json', botDefaults = {}) {
  const filePath = path.resolve(customConfigPath);

  const baseDefaults = {
    botName: 'WhatsApp Bot',
    prefix: '.',
    ownerPhone: '5574998000519',
    ownerPhones: ['5574998000519'],
    commandsEnabled: false, // Inicia desativado por padrão
    allowPublicCommands: false, // Inicia desativado pro público por padrão
    mode: 'off', // 'view' | 'like' | 'both' | 'off'
    emoji: '❤️',
    autoViewStatus: false,
    autoLikeStatus: false,
    autoLikeEmoji: '❤️',
    autoDownload: false,
    autoDeleteWord: false,
    autoAnimeNotify: false,
    typingChats: {},
    alwaysTypingChats: [],
    stickerPack: 'WhatsApp Bot',
    stickerAuthor: 'Bot',
    malClientId: '368675841a014b3b3ce2419c6b875cb8',
    malUsername: 'farinhadetrigo',
    ...botDefaults
  };

  let configData = { ...baseDefaults };
  let saveTimer = null;
  let isDirty = false;

  // Cache em memória de telefones normalizados para validação em O(1)
  let cachedOwnerPhones = [];
  let cachedOwnerSet = new Set();

  function updateOwnerCache() {
    const list = new Set();

    function addPhone(p) {
      if (typeof p === 'string' || typeof p === 'number') {
        const clean = String(p).replace(/\D/g, '');
        if (clean) {
          list.add(clean);
          if ((clean.length === 10 || clean.length === 11) && !clean.startsWith('55')) {
            list.add('55' + clean);
          } else if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
            list.add(clean.slice(2));
          }
        }
      }
    }

    if (Array.isArray(configData.ownerPhones)) {
      for (const p of configData.ownerPhones) {
        addPhone(p);
      }
    }

    const singlePhone = configData.ownerPhone || configData.phoneNumber;
    if (singlePhone) {
      addPhone(singlePhone);
    }

    cachedOwnerPhones = Array.from(list);
    cachedOwnerSet = new Set(cachedOwnerPhones);
  }

  function syncStatusModes(cfg) {
    if (cfg.mode) {
      if (cfg.mode === 'both') {
        cfg.autoViewStatus = true;
        cfg.autoLikeStatus = true;
      } else if (cfg.mode === 'view') {
        cfg.autoViewStatus = true;
        cfg.autoLikeStatus = false;
      } else if (cfg.mode === 'like') {
        cfg.autoViewStatus = false;
        cfg.autoLikeStatus = true;
      } else if (cfg.mode === 'off') {
        cfg.autoViewStatus = false;
        cfg.autoLikeStatus = false;
      }
    } else {
      if (cfg.autoViewStatus && cfg.autoLikeStatus) cfg.mode = 'both';
      else if (cfg.autoViewStatus) cfg.mode = 'view';
      else if (cfg.autoLikeStatus) cfg.mode = 'like';
      else cfg.mode = 'off';
    }

    if (cfg.emoji && (!cfg.autoLikeEmoji || cfg.emoji !== cfg.autoLikeEmoji)) {
      cfg.autoLikeEmoji = cfg.emoji;
    } else if (cfg.autoLikeEmoji && (!cfg.emoji || cfg.autoLikeEmoji !== cfg.emoji)) {
      cfg.emoji = cfg.autoLikeEmoji;
    }
  }

  function load() {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        configData = { ...baseDefaults, ...parsed };
      } else {
        configData = { ...baseDefaults };
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(configData, null, 2), 'utf8');
      }
    } catch (err) {
      logger.error('CONFIG', `Erro ao carregar ${filePath}, usando defaults`, err);
      configData = { ...baseDefaults };
    }

    syncStatusModes(configData);
    updateOwnerCache();
    return configData;
  }

  function flush() {
    if (!isDirty && !saveTimer) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify(configData, null, 2), 'utf8');
      isDirty = false;
    } catch (err) {
      logger.error('CONFIG', `Erro ao salvar ${filePath}`, err);
    }
  }

  function save(newFields = null) {
    if (newFields && typeof newFields === 'object') {
      Object.assign(configData, newFields);
      syncStatusModes(configData);
      updateOwnerCache();
    }
    isDirty = true;

    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush();
      }, 1000);
    }
  }

  function isSamePhone(phoneA, phoneB) {
    if (!phoneA || !phoneB) return false;
    let a = String(phoneA).replace(/\D/g, '');
    let b = String(phoneB).replace(/\D/g, '');
    if (a === b) return true;

    // Normaliza DDI 55 para ambos se forem números brasileiros (10 ou 11 dígitos sem 55)
    if ((a.length === 10 || a.length === 11) && !a.startsWith('55')) a = '55' + a;
    if ((b.length === 10 || b.length === 11) && !b.startsWith('55')) b = '55' + b;
    if (a === b) return true;

    // Tratamento otimizado de 9 dígitos no Brasil
    if (a.startsWith('55') && b.startsWith('55')) {
      const dddA = a.slice(2, 4);
      const dddB = b.slice(2, 4);
      if (dddA === dddB) {
        const numA = a.slice(4);
        const numB = b.slice(4);
        if (numA.length === 9 && numA[0] === '9' && numA.slice(1) === numB) return true;
        if (numB.length === 9 && numB[0] === '9' && numB.slice(1) === numA) return true;
      }
    }
    return false;
  }

  function isOwner(senderJidOrNum, sockUser = null) {
    if (!senderJidOrNum) return false;
    const cleanSender = String(senderJidOrNum).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanSender) return false;

    // Validação direta via Set O(1)
    if (cachedOwnerSet.has(cleanSender)) return true;

    // Compara com o próprio bot conectado (LID ou telefone)
    if (sockUser?.id) {
      const botNum = sockUser.id.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanSender === botNum || isSamePhone(cleanSender, botNum)) return true;
    }
    if (sockUser?.lid) {
      const botLid = sockUser.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanSender === botLid) return true;
    }

    // Validação com tolerância a 9 dígitos
    for (const owner of cachedOwnerPhones) {
      if (isSamePhone(cleanSender, owner)) return true;
    }

    return false;
  }

  process.on('exit', flush);
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });

  load();

  return {
    get: () => configData,
    save,
    flush,
    reload: load,
    getOwnerPhones: () => cachedOwnerPhones,
    isOwner,
    isSamePhone
  };
}
