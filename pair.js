/**
 * Script auxiliar de pareamento manual (QR Code ou Código de Pareamento)
 * Utiliza o mesmo núcleo de conexão seguro e modular.
 */

import { logger } from './src/core/logger.js';
import { createConfigManager } from './src/core/config.js';
import { createStoreManager } from './src/core/store.js';
import { createWhatsAppConnection } from './src/core/connection.js';

async function pair() {
  const configManager = createConfigManager('./config.json');
  const storeManager = createStoreManager('./data/storage.json', './stats.json');

  logger.banner('ASSISTENTE DE PAREAMENTO WHATSAPP', [
    'Iniciando conexão temporária para autenticação...',
    'Aguarde o QR Code ou Código de Pareamento.'
  ]);

  const connection = createWhatsAppConnection({
    sessionDir: './session',
    configManager,
    storeManager,
    onOpen: () => {
      logger.success('PAREAMENTO', '✅ Aparelho pareado e autenticado com sucesso!');
      logger.info('PAREAMENTO', 'Encerrando script auxiliar. O bot principal já pode ser iniciado normalmente.');
      setTimeout(() => process.exit(0), 2000);
    }
  });

  await connection.connect();
}

pair().catch((err) => {
  logger.error('PAIR', 'Erro durante o pareamento:', err);
  process.exit(1);
});
