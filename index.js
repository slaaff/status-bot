/**
 * WhatsApp Status Bot (Dedicado, Ultraleve & Otimizado)
 *
 * Funcionalidades:
 * - Visualizador e Curtidor Automático de Status (Stories) com preservação de círculo verde
 * - Presença fake contínua (Digitando, Gravando áudio, Online)
 * - Rastreamento em tempo real de visualizações recebidas nos status da própria conta
 * - Arquitetura unificada e modular
 */

import { logger } from './src/core/logger.js';
import { createConfigManager } from './src/core/config.js';
import { createStoreManager } from './src/core/store.js';
import { createDispatcher } from './src/core/dispatcher.js';
import { createWhatsAppConnection } from './src/core/connection.js';
import { createStatusHandler } from './src/handlers/statusHandler.js';
import { createPresenceHandler } from './src/handlers/presenceHandler.js';
import { registerCoreCommands } from './src/commands/core/index.js';

async function main() {
  const configManager = createConfigManager('./config.json', {
    botName: 'Status Bot Pessoal',
    prefix: '.',
    mode: 'both',
    emoji: '💚'
  });

  const storeManager = createStoreManager('./data/storage.json', './stats.json');

  const config = configManager.get();
  logger.banner(config.botName, [
    `Prefixo Ativo: ${config.prefix}`,
    `Donos: ${configManager.getOwnerPhones().join(', ') || 'Nenhum'}`,
    `Modo Inicial: ${config.mode.toUpperCase()} (Emoji: ${config.emoji})`,
    'Inicializando gerenciadores e listeners...'
  ]);

  const dispatcher = createDispatcher({ configManager, storeManager });
  const statusHandler = createStatusHandler({ configManager, storeManager });
  const presenceHandler = createPresenceHandler({ configManager, storeManager });

  // Registrar comandos do Status Bot
  registerCoreCommands(dispatcher, { presenceHandler, isFullBot: false });

  // Criar conexão unificada do WhatsApp
  const connection = createWhatsAppConnection({
    sessionDir: './session',
    configManager,
    storeManager,

    onOpen: (sock) => {
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

  // Iniciar conexão
  await connection.connect();
}

main().catch((err) => {
  logger.error('FATAL', 'Falha crítica na inicialização do Status Bot', err);
  process.exit(1);
});
