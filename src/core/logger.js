/**
 * Logger centralizado e padronizado para os bots WhatsApp
 * - Cores ANSI no terminal
 * - Timestamp no fuso horário brasileiro (America/Sao_Paulo)
 * - Supressão inteligente de ruídos do libsignal
 * - Sanitização de dados sensíveis
 */

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// Silencia logs internos ruidosos do libsignal para economizar CPU, disco e manter logs limpos
const origConsoleInfo = console.info;
console.info = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Closing session') ||
    args[0].startsWith('Opening session') ||
    args[0].startsWith('Session already') ||
    args[0].startsWith('Removing old closed session') ||
    args[0].startsWith('Migrating session')
  )) {
    return;
  }
  origConsoleInfo(...args);
};

const origConsoleWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Closing open session') ||
    args[0].startsWith('Decrypted message with closed session') ||
    args[0].startsWith('Session already')
  )) {
    return;
  }
  origConsoleWarn(...args);
};

const origConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].startsWith('Failed to decrypt message') ||
    args[0].startsWith('Session error:Error: Bad MAC')
  )) {
    return;
  }
  origConsoleError(...args);
};

function formatTimestamp() {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function sanitize(message) {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }
  // Mascara tokens do GitHub, senhas e credenciais privadas caso vazem em erros
  return message
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, 'gho_***')
    .replace(/(password|senha|token|secret)['":\s]+([^'",\s]+)/gi, '$1: ***');
}

export const logger = {
  colors,

  info(tag, message) {
    const time = formatTimestamp();
    console.log(`${colors.gray}[${time}]${colors.reset} ${colors.cyan}[${tag}]${colors.reset} ${sanitize(message)}`);
  },

  success(tag, message) {
    const time = formatTimestamp();
    console.log(`${colors.gray}[${time}]${colors.reset} ${colors.green}[${tag}]${colors.reset} ${sanitize(message)}`);
  },

  warn(tag, message) {
    const time = formatTimestamp();
    console.log(`${colors.gray}[${time}]${colors.reset} ${colors.yellow}[${tag}]${colors.reset} ${sanitize(message)}`);
  },

  error(tag, message, err = null) {
    const time = formatTimestamp();
    const cleanMsg = sanitize(message);
    const errDetails = err?.message ? ` (${sanitize(err.message)})` : '';
    console.error(`${colors.gray}[${time}]${colors.reset} ${colors.red}[${tag}]${colors.reset} ${cleanMsg}${errDetails}`);
    if (err && process.env.DEBUG) {
      console.error(err.stack);
    }
  },

  status(tag, message) {
    const time = formatTimestamp();
    console.log(`${colors.gray}[${time}]${colors.reset} ${colors.magenta}[${tag}]${colors.reset} ${sanitize(message)}`);
  },

  banner(title, lines = []) {
    console.log(`\n${colors.cyan}${colors.bold}====================================================`);
    console.log(`  ${title}`);
    console.log(`====================================================${colors.reset}`);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log(`${colors.cyan}====================================================${colors.reset}\n`);
  }
};
