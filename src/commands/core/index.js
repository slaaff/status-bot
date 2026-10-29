/**
 * Registro Central de Comandos Essenciais (Core)
 */

import { registerStatusControlCommands } from './statusControl.js';
import { registerPresenceCommands } from './presence.js';
import { registerStatusCommand } from './status.js';
import { registerRestartCommand } from './restart.js';
import { registerPingCommand } from './ping.js';

export function registerCoreCommands(dispatcher, options = {}) {
  const { presenceHandler, isFullBot = false } = options;

  registerStatusControlCommands(dispatcher);
  if (presenceHandler) {
    registerPresenceCommands(dispatcher, presenceHandler);
  }
  registerStatusCommand(dispatcher, { isFullBot });
  registerRestartCommand(dispatcher);
  registerPingCommand(dispatcher);
}
