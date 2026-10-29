/**
 * Gerenciador centralizado de configurações
 * - Carregamento seguro com valores padrão
 * - Gravação debounced com flush garantido no encerramento do processo
 * - Normalização e verificação de números de donos (compatível com 8 e 9 dígitos no Brasil)
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
    mode: 'both', // 'view' | 'like' | 'both' | 'off'
    emoji: '❤️',
    autoViewStatus: true,
    autoLikeStatus: true,
    autoLikeEmoji: '❤️',
    autoDownload: true,
    autoDeleteWord: true,
    autoAnimeNotify: true,
    allowPublicCommands: false,
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

  function syncStatusModes(cfg) {
    // Sincroniza 'mode' com 'autoViewStatus' e 'autoLikeStatus'
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

    // Sincroniza emoji
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
    }
    isDirty = true;

    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush();
      }, 1000);
    }
  }

  function getOwnerPhones() {
    const list = new Set();

    if (Array.isArray(configData.ownerPhones)) {
      for (const p of configData.ownerPhones) {
        if (typeof p === 'string') {
          const clean = p.replace(/\D/g, '');
          if (clean) list.add(clean);
        }
      }
    }

    const singlePhone = configData.ownerPhone || configData.phoneNumber;
    if (typeof singlePhone === 'string') {
      const clean = singlePhone.replace(/\D/g, '');
      if (clean) list.add(clean);
    }

    return Array.from(list);
  }

  function isSamePhone(phoneA, phoneB) {
    if (!phoneA || !phoneB) return false;
    const a = String(phoneA).replace(/\D/g, '');
    const b = String(phoneB).replace(/\D/g, '');
    if (a === b) return true;

    // Tratamento para 9º dígito no Brasil (+55 DDD 9XXXX-XXXX vs +55 DDD XXXX-XXXX)
    if (a.startsWith('55') && b.startsWith('55')) {
      const dddA = a.slice(2, 4);
      const dddB = b.slice(2, 4);
      if (dddA === dddB) {
        const numA = a.slice(4);
        const numB = b.slice(4);
        if (numA.length === 9 && numA.startsWith('9') && numA.slice(1) === numB) return true;
        if (numB.length === 9 && numB.startsWith('9') && numB.slice(1) === numA) return true;
      }
    }
    return false;
  }

  function isOwner(senderJidOrNum, sockUser = null) {
    if (!senderJidOrNum) return false;
    const cleanSender = String(senderJidOrNum).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanSender) return false;

    // Compara com o próprio bot conectado (LID ou fone)
    if (sockUser?.id) {
      const botNum = sockUser.id.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (isSamePhone(cleanSender, botNum)) return true;
    }
    if (sockUser?.lid) {
      const botLid = sockUser.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanSender === botLid) return true;
    }

    const owners = getOwnerPhones();
    for (const owner of owners) {
      if (isSamePhone(cleanSender, owner)) return true;
    }

    return false;
  }

  // Registra flush automático no encerramento
  process.on('exit', flush);
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });

  load();

  return {
    get: () => configData,
    save,
    flush,
    reload: load,
    getOwnerPhones,
    isOwner,
    isSamePhone
  };
}
