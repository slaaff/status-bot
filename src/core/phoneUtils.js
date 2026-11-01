/**
 * Utilitários de Normalização e Comparação de Telefones do WhatsApp
 * Suporte a LIDs (identificadores multi-device) e telefones brasileiros (8 e 9 dígitos)
 */

import fs from 'fs';

const KNOWN_LID_PHONE_MAP = {
  '242107960811698': '5583921490880',
  '49396418875542': '5574998000519'
};

const KNOWN_PHONE_LID_MAP = {
  '5583921490880': '242107960811698',
  '558321490880': '242107960811698',
  '5574998000519': '49396418875542',
  '557498000519': '49396418875542'
};

export function normalizePhone(input) {
  if (!input) return '';
  return String(input).split('@')[0].split(':')[0].replace(/\D/g, '');
}

export function resolveLidToPhone(lidOrPhone, sessionDir = './session') {
  const clean = normalizePhone(lidOrPhone);
  if (!clean) return '';
  if (KNOWN_LID_PHONE_MAP[clean]) return KNOWN_LID_PHONE_MAP[clean];

  if (sessionDir) {
    const revFile = `${sessionDir}/lid-mapping-${clean}_reverse.json`;
    if (fs.existsSync(revFile)) {
      try {
        const res = JSON.parse(fs.readFileSync(revFile, 'utf8'));
        if (res) return normalizePhone(res);
      } catch {}
    }
  }
  return clean;
}

export function resolvePhoneToLid(phone, sessionDir = './session') {
  const clean = normalizePhone(phone);
  if (!clean) return null;
  if (KNOWN_PHONE_LID_MAP[clean]) return KNOWN_PHONE_LID_MAP[clean];

  if (sessionDir) {
    const mapFile = `${sessionDir}/lid-mapping-${clean}.json`;
    if (fs.existsSync(mapFile)) {
      try {
        const res = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
        if (res) return normalizePhone(res);
      } catch {}
    }
  }
  return null;
}

export function phonesMatch(p1, p2) {
  let n1 = normalizePhone(p1);
  let n2 = normalizePhone(p2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  // Resolve LIDs caso um seja LID e o outro telefone
  const r1 = resolveLidToPhone(n1);
  const r2 = resolveLidToPhone(n2);
  if (r1 === r2) return true;

  // Comparação de últimos 8 dígitos (número base brasileiro)
  if (r1.length >= 8 && r2.length >= 8) {
    const end1 = r1.slice(-8);
    const end2 = r2.slice(-8);
    if (end1 === end2) {
      const ddd1 = r1.length >= 10 ? r1.slice(-10, -8) : '';
      const ddd2 = r2.length >= 10 ? r2.slice(-10, -8) : '';
      if (ddd1 && ddd2) {
        return ddd1 === ddd2;
      }
      return true;
    }
  }
  return false;
}

export function isPhoneInList(targetPhone, list) {
  if (!Array.isArray(list) || !targetPhone) return false;
  const target = normalizePhone(targetPhone);
  return list.some(item => phonesMatch(target, item));
}

export function formatPhone(phone) {
  const resolved = resolveLidToPhone(phone);
  const norm = normalizePhone(resolved);
  if (!norm) return '';
  if (norm.startsWith('55') && norm.length >= 12) {
    const ddd = norm.slice(2, 4);
    const rest = norm.slice(4);
    if (rest.length === 9) {
      return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    } else if (rest.length === 8) {
      return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
  }
  return `+${norm}`;
}

export function getPhoneVariants(phone, sessionDir = './session') {
  const norm = normalizePhone(phone);
  if (!norm) return [];
  const variants = new Set([norm]);

  // Se for LID, adiciona o telefone mapeado
  const resolvedPhone = resolveLidToPhone(norm, sessionDir);
  if (resolvedPhone && resolvedPhone !== norm) {
    variants.add(resolvedPhone);
  }

  // Se for telefone, tenta encontrar o LID
  const lid = resolvePhoneToLid(norm, sessionDir);
  if (lid) variants.add(lid);

  const baseForVariants = resolvedPhone || norm;

  // Se for número brasileiro com 55 e DDD (ex: 5585981334462 ou 558581334462)
  if (baseForVariants.startsWith('55') && (baseForVariants.length === 12 || baseForVariants.length === 13)) {
    const ddd = baseForVariants.slice(2, 4);
    const rest = baseForVariants.slice(4);
    if (baseForVariants.length === 13 && rest.startsWith('9')) {
      variants.add(`55${ddd}${rest.slice(1)}`);
      variants.add(`${ddd}${rest.slice(1)}`);
      variants.add(`${ddd}${rest}`);
    } else if (baseForVariants.length === 12) {
      variants.add(`55${ddd}9${rest}`);
      variants.add(`${ddd}9${rest}`);
      variants.add(`${ddd}${rest}`);
    }
  } else if (!baseForVariants.startsWith('55') && (baseForVariants.length === 10 || baseForVariants.length === 11)) {
    const ddd = baseForVariants.slice(0, 2);
    const rest = baseForVariants.slice(2);
    variants.add(`55${baseForVariants}`);
    if (baseForVariants.length === 11 && rest.startsWith('9')) {
      variants.add(`55${ddd}${rest.slice(1)}`);
      variants.add(`${ddd}${rest.slice(1)}`);
    } else if (baseForVariants.length === 10) {
      variants.add(`55${ddd}9${rest}`);
      variants.add(`${ddd}9${rest}`);
    }
  }

  return Array.from(variants);
}
