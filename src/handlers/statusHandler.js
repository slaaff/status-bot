/**
 * Handler Unificado de WhatsApp Status (Stories)
 * - Visualização automática (readMessages)
 * - Curtida automática com preservação do círculo verde (sendMessage react statusJidList)
 * - Rastreamento de visualizações recebidas nos status da própria conta (message-receipt.update / messages.update)
 * - Deduplicação em memória (máx 3000 status)
 */

import { logger } from '../core/logger.js';

export function createStatusHandler(options) {
  const { configManager, storeManager } = options;

  const processedStatusIds = new Set();
  const MAX_PROCESSED_STATUS = 3000;

  function isAlreadyProcessed(id) {
    if (!id) return false;
    if (processedStatusIds.has(id)) return true;
    if (processedStatusIds.size >= MAX_PROCESSED_STATUS) {
      const oldest = processedStatusIds.values().next().value;
      processedStatusIds.delete(oldest);
    }
    processedStatusIds.add(id);
    return false;
  }

  async function handleStatusMessage(m, sock) {
    if (!m.message) return;
    const remoteJid = m.key.remoteJid;
    if (remoteJid !== 'status@broadcast') return;

    const participant = m.key.participant;
    if (m.key.fromMe || !participant) return;

    if (isAlreadyProcessed(m.key.id)) return;

    const cfg = configManager.get();
    const shouldView = Boolean(cfg.autoViewStatus || cfg.mode === 'view' || cfg.mode === 'both');
    const shouldLike = Boolean(cfg.autoLikeStatus || cfg.mode === 'like' || cfg.mode === 'both');

    if (!shouldView && !shouldLike) return;

    try {
      const statusKey = {
        remoteJid: 'status@broadcast',
        id: m.key.id,
        participant: participant
      };
      const sender = participant.split('@')[0] || 'Contato';

      // 1. Marcar como Visto (apenas se shouldView for verdadeiro)
      if (shouldView) {
        await sock.readMessages([statusKey]);
        const count = storeManager.incrementViewed();
        logger.status('STATUS', `👁️ Status visto de +${sender} (Total visualizados: ${count})`);
      }

      // 2. Reagir / Curtir Status
      if (shouldLike) {
        const emoji = cfg.autoLikeEmoji || cfg.emoji || '❤️';
        await sock.sendMessage('status@broadcast', {
          react: {
            text: emoji,
            key: statusKey
          }
        }, {
          statusJidList: [participant]
        });

        const count = storeManager.incrementLiked();
        const preservedNote = !shouldView ? ' (🟢 Círculo verde preservado no celular)' : '';
        logger.status('STATUS', `❤️ Status curtido com ${emoji} de +${sender}${preservedNote} (Total curtidos: ${count})`);
      }
    } catch (err) {
      logger.error('STATUS', `Erro ao processar status: ${err.message}`);
    }
  }

  function handleReceipts(receipts) {
    if (!Array.isArray(receipts)) return;

    for (const item of receipts) {
      if (item.key?.remoteJid === 'status@broadcast') {
        const statusId = item.key.id;
        const viewer = item.receipt?.userJid;
        const isRead = Boolean(item.receipt?.readTimestamp);

        if (isRead && viewer) {
          const added = storeManager.addStatusViewer(statusId, viewer);
          if (added) {
            const viewerNum = viewer.split('@')[0];
            const total = storeManager.get().statusViewsReceivedCount || 0;
            logger.status('STATUS', `👀 Status visualizado por +${viewerNum} (Total views recebidas: ${total})`);
          }
        }
      }
    }
  }

  function handleMessagesUpdate(updates) {
    if (!Array.isArray(updates)) return;

    for (const item of updates) {
      if (item.key?.remoteJid === 'status@broadcast') {
        const statusId = item.key.id;
        const userReceipts = item.update?.userReceipt;

        if (Array.isArray(userReceipts)) {
          let anyAdded = false;
          for (const ur of userReceipts) {
            if (ur.userJid && ur.readTimestamp) {
              const added = storeManager.addStatusViewer(statusId, ur.userJid);
              if (added) anyAdded = true;
            }
          }
          if (anyAdded) {
            const total = storeManager.get().statusViewsReceivedCount || 0;
            logger.status('STATUS', `👀 Visualizações de status atualizadas (Total views recebidas: ${total})`);
          }
        }
      }
    }
  }

  return {
    handleStatusMessage,
    handleReceipts,
    handleMessagesUpdate
  };
}
