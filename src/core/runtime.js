/**
 * Proteções Globais de Runtime, Desligamento Gracioso e Manutenção de Memória
 * Compartilhado de forma idêntica entre whatsapp-bot e status-bot.
 */

export function setupRuntimeGuards(options) {
  const {
    botName = 'Bot',
    logger,
    configManager,
    storeManager,
    presenceHandler,
    connection,
    messageStore,
    gcIntervalMs = 5 * 60 * 1000
  } = options;

  let shuttingDown = false;
  let startedConnection = false;

  const RECOVERABLE_ERROR_RE = /ECONNRESET|ETIMEDOUT|ECONNABORTED|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|WebSocket|Stream Errored|Connection Closed|Timed Out|fetch failed/i;

  function markConnected() {
    startedConnection = true;
  }

  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('SISTEMA', `[${botName}] Sinal ${signal} recebido. Salvando estado e encerrando...`);

    try { presenceHandler?.stop?.(); } catch {}
    try { connection?.close?.(); } catch {}
    try { storeManager?.flush?.(); } catch {}
    try { configManager?.flush?.(); } catch {}

    setTimeout(() => process.exit(0), 300).unref();
  }

  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error('RUNTIME', `Promise rejeitada não tratada (${botName}): ${msg}`);
  });

  process.on('uncaughtException', (err) => {
    const msg = err?.message || String(err);
    const code = err?.code || '';
    const isRecoverable = startedConnection && (RECOVERABLE_ERROR_RE.test(msg) || RECOVERABLE_ERROR_RE.test(code));

    logger.error('RUNTIME', `Exceção não capturada (${botName}): ${msg}`);

    if (!isRecoverable) {
      try { storeManager?.flush?.(); } catch {}
      try { configManager?.flush?.(); } catch {}
      process.exit(1);
    }
  });

  const maintenanceTimer = setInterval(() => {
    try { messageStore?.prune?.(); } catch {}
    if (typeof global.gc === 'function') {
      try { global.gc(); } catch {}
    }
  }, gcIntervalMs);

  maintenanceTimer.unref?.();

  return {
    markConnected,
    stop: () => clearInterval(maintenanceTimer)
  };
}
