/**
 * WhatsApp Status Bot (Dedicado, Ultraleve & Padronizado)
 *
 * Funcionalidades (sem extras):
 * - Visualizador e Curtidor Automático de Status (Stories) com preservação de círculo verde
 * - Presença fake contínua (Digitando, Gravando áudio, Online)
 * - Comandos de Status, Grupos e Figurinhas exclusivamente no prefixo '.'
 * - Núcleo 100% padronizado com o whatsapp-bot e controle estrito de memória
 */

import { logger } from './src/core/logger.js';
import { createConfigManager } from './src/core/config.js';
import { createStoreManager } from './src/core/store.js';
import { createMessageStore } from './src/core/messageStore.js';
import { createDispatcher } from './src/core/dispatcher.js';
import { createWhatsAppConnection } from './src/core/connection.js';
import { setupRuntimeGuards } from './src/core/runtime.js';
import { createStatusHandler } from './src/handlers/statusHandler.js';
import { createPresenceHandler } from './src/handlers/presenceHandler.js';
import { registerCoreCommands } from './src/commands/core/index.js';
import { registerGroupCommands } from './src/commands/group/group.js';
import { registerMenuCommand } from './src/commands/menu.js';
import { registerStickerCommands } from './src/commands/media/stickers.js';

async function main() {
  const configManager = createConfigManager('./config.json', {
    botName: 'Status Bot Pessoal',
    prefix: '.',
    mode: 'like',
    emoji: '💚'
  });

  const storeManager = createStoreManager('./data/storage.json', './stats.json');
  const messageStore = createMessageStore({
    maxMessages: 150,
    maxAgeMs: 20 * 60 * 1000
  });

  const config = configManager.get();
  if (config.prefix !== '.') {
    configManager.save({ prefix: '.' });
  }

  logger.banner(config.botName, [
    'Prefixo Estrito: . (ignora !)',
    `Donos: ${configManager.getOwnerPhones().join(', ') || 'Nenhum'}`,
    `Modo Inicial: ${(config.mode || 'like').toUpperCase()} (Emoji: ${config.emoji || '💚'})`,
    'Inicializando gerenciadores e listeners...'
  ]);

  const dispatcher = createDispatcher({
    configManager,
    storeManager,
    messageStore,
    prefix: '.',
    ignoredPrefixes: ['!']
  });

  const statusHandler = createStatusHandler({ configManager, storeManager });
  const presenceHandler = createPresenceHandler({ configManager, storeManager });

  // Registrar apenas os módulos do Status Bot (sem funções extras)
  registerCoreCommands(dispatcher, { presenceHandler, isFullBot: false });
  registerGroupCommands(dispatcher);
  registerMenuCommand(dispatcher);
  registerStickerCommands(dispatcher);

  let runtimeGuards = null;

  // Criar conexão unificada do WhatsApp
  const connection = createWhatsAppConnection({
    sessionDir: './session',
    configManager,
    storeManager,
    messageStore,
    authCacheSize: 600,
    retryCacheSize: 40,
    retryCounterSize: 80,
    groupCacheSize: 100,

    onOpen: (sock) => {
      runtimeGuards?.markConnected();
      presenceHandler.start(sock);
    },

    onClose: () => {
      presenceHandler.stop();
    },

    onMessage: (messages, sock) => {
      for (const m of messages) {
        if (m.key.remoteJid === 'status@broadcast') {
          statusHandler.handleStatusMessage(m, sock).catch(err => {
            logger.error('STATUS', `Erro no status: ${err.message}`);
          });
          continue;
        }

        dispatcher.handleMessage(m, sock).catch(err => {
          logger.error('DISPATCHER', `Erro no comando: ${err.message}`);
        });
      }
    },

    onReceipt: (receipts) => {
      statusHandler.handleReceipts(receipts);
    },

    onMessagesUpdate: (updates) => {
      statusHandler.handleMessagesUpdate(updates);
    }
  });

  runtimeGuards = setupRuntimeGuards({
    botName: 'status-bot',
    logger,
    configManager,
    storeManager,
    presenceHandler,
    connection,
    messageStore,
    gcIntervalMs: 5 * 60 * 1000
  });

  await connection.connect();
}

main().catch((err) => {
  logger.error('FATAL', 'Falha crítica na inicialização do Status Bot', err);
  process.exit(1);
});
