/**
 * Gerenciador centralizado de configurações
 * - Carregamento seguro com valores padrão
 * - Gravação debounced com flush garantido no encerramento do processo
 * - Cache de telefones e LIDs normalizados para latência ultra-baixa O(1)
 * - Suporte robusto a múltiplos donos (reconhecimento por LID, DDI, 8 e 9 dígitos)
 * - Sincronização automática entre modos de status (mode <-> autoViewStatus/autoLikeStatus)
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { resolveLidToPhone } from './phoneUtils.js';

export function createConfigManager(customConfigPath = './config.json', botDefaults = {}) {
  const filePath = path.resolve(customConfigPath);

  const baseDefaults = {
    botName: 'Status Bot Pessoal',
    prefix: '.',
    phoneNumber: '5574998000519',
    ownerPhone: '5574998000519',
    ownerPhones: ['5574998000519', '5583921490880'],
    ownerLids: ['49396418875542', '242107960811698'],
    commandsEnabled: true,
    allowPublicCommands: false, // Inicia desativado pro público por padrão
    mode: 'like', // 'view' | 'like' | 'both' | 'off'
    emoji: '💚',
    autoViewStatus: false,
    autoLikeStatus: true,
    autoLikeEmoji: '💚',
    autoDownload: false,
    autoDeleteWord: false,
    autoAnimeNotify: false,
    typingChats: {},
    alwaysTypingChats: [],
    stickerPack: 'WhatsApp Bot',
    stickerAuthor: 'Bot',
    ...botDefaults
  };

  let configData = { ...baseDefaults };
  let saveTimer = null;
  let isDirty = false;

  // LIDs conhecidos e imutáveis dos dois donos (identificadores multi-device do WhatsApp)
  const KNOWN_OWNER_LIDS = [
    '49396418875542', // Dono 1: João Vitor (5574998000519 / 557498000519)
    '242107960811698'  // Dono 2: Cloud Connect (5583921490880)
  ];

  // Cache em memória de telefones e LIDs para validação em O(1)
  let cachedPrimaryOwnerPhones = [];
  let cachedOwnerPhones = [];
  let cachedOwnerSet = new Set();

  function updateOwnerCache() {
    const fullSet = new Set();
    const phoneSet = new Set();
    const primaryPhones = [];

    function addPrimary(p) {
      if (typeof p === 'string' || typeof p === 'number') {
        let clean = String(p).replace(/\D/g, '');
        if (!clean) return;
        if ((clean.length === 10 || clean.length === 11) && !clean.startsWith('55')) {
          clean = '55' + clean;
        }
        if (clean.startsWith('55') && clean.length === 12) {
          clean = clean.slice(0, 4) + '9' + clean.slice(4);
        }
        if (!primaryPhones.includes(clean)) {
          primaryPhones.push(clean);
        }
      }
    }

    function addPhone(p) {
      if (typeof p === 'string' || typeof p === 'number') {
        let clean = String(p).replace(/\D/g, '');
        if (!clean) return;

        fullSet.add(clean);
        phoneSet.add(clean);

        // Gera todas as variações brasileiras (com/sem 55, com/sem 9º dígito)
        let local = clean;
        if (local.startsWith('55') && (local.length === 12 || local.length === 13)) {
          local = local.slice(2);
        }

        if (local.length === 10 || local.length === 11) {
          const ddd = local.slice(0, 2);
          const rest = local.slice(2);

          let withNine = '';
          let withoutNine = '';

          if (rest.length === 9) {
            withNine = rest;
            withoutNine = rest.slice(1);
          } else if (rest.length === 8) {
            withoutNine = rest;
            withNine = '9' + rest;
          }

          if (withNine) {
            const num11 = ddd + withNine;
            fullSet.add(num11);
            fullSet.add('55' + num11);
            phoneSet.add(num11);
            phoneSet.add('55' + num11);
          }

          if (withoutNine) {
            const num10 = ddd + withoutNine;
            fullSet.add(num10);
            fullSet.add('55' + num10);
            phoneSet.add(num10);
            phoneSet.add('55' + num10);
          }
        }
      }
    }

    function addLid(l) {
      if (typeof l === 'string' || typeof l === 'number') {
        const clean = String(l).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (clean) {
          fullSet.add(clean);
        }
      }
    }

    // 1. Processa telefones dos donos configurados
    if (Array.isArray(configData.ownerPhones)) {
      for (const p of configData.ownerPhones) {
        addPrimary(p);
        addPhone(p);
      }
    }

    const singlePhone = configData.ownerPhone || configData.phoneNumber;
    if (singlePhone) {
      addPrimary(singlePhone);
      addPhone(singlePhone);
    }

    // 2. Registra LIDs conhecidos dos donos
    for (const lid of KNOWN_OWNER_LIDS) {
      addLid(lid);
    }

    // 3. Registra LIDs configurados em configData.ownerLids
    if (Array.isArray(configData.ownerLids)) {
      for (const l of configData.ownerLids) {
        addLid(l);
      }
    }

    cachedPrimaryOwnerPhones = primaryPhones;
    cachedOwnerPhones = Array.from(phoneSet);
    cachedOwnerSet = fullSet;
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

  function isOwner(senderJidOrNum, sockUser = null, store = null) {
    if (!senderJidOrNum) return false;
    const cleanSender = String(senderJidOrNum).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanSender) return false;

    // 1. Validação O(1) no Set pré-indexado (contém todas variações de telefones e LIDs dos donos)
    if (cachedOwnerSet.has(cleanSender)) return true;

    // 2. Resolve LID para telefone caso seja um LID conhecido ou mapeado na sessão
    try {
      const resolved = resolveLidToPhone(cleanSender);
      if (resolved && resolved !== cleanSender && cachedOwnerSet.has(resolved)) {
        return true;
      }
    } catch {}

    // 3. Compara com a sessão ativa conectada do Baileys (telefone ou LID)
    if (sockUser?.id) {
      const botNum = sockUser.id.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanSender === botNum || isSamePhone(cleanSender, botNum)) return true;
    }
    if (sockUser?.lid) {
      const botLid = sockUser.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanSender === botLid) return true;
    }

    // 4. Compara com JIDs/LIDs salvos dinamicamente no store
    if (store && Array.isArray(store.ownerChatJids)) {
      for (const jid of store.ownerChatJids) {
        if (!jid) continue;
        const cleanJid = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (cleanJid === cleanSender) return true;
      }
    }

    // 5. Validação com tolerância a 9 dígitos para telefones
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
    getOwnerPhones: () => cachedPrimaryOwnerPhones,
    isOwner,
    isSamePhone
  };
}
