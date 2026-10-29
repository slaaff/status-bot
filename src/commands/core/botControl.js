/**
 * Comandos de Controle Mestre e Acesso Público
 * .bot [on/off], .ativar, .desativar, .comandos [on/off], .publico [on/off]
 */

export function registerBotControlCommands(dispatcher) {
  // 1. Controle Mestre de Comandos: .bot / .ativar / .desativar / .comandos
  dispatcher.registerCommand({
    name: 'bot',
    aliases: ['ativar', 'desativar', 'comandos', 'botstatus'],
    ownerOnly: true,
    description: 'Ativa ou desativa o processamento geral de comandos do bot',
    execute: async (ctx) => {
      const { command, args, prefix, configManager } = ctx;
      const opt = (args[0] || '').toLowerCase();

      let newState;
      if (['ativar', 'on', 'ligar', '1', 'sim', 'true'].includes(command) || ['on', '1', 'ativar', 'ligar', 'sim', 'true'].includes(opt)) {
        newState = true;
      } else if (['desativar', 'off', 'desligar', '0', 'nao', 'não', 'false'].includes(command) || ['off', '0', 'desativar', 'desligar', 'nao', 'não', 'false'].includes(opt)) {
        newState = false;
      } else {
        // Toggle
        newState = !ctx.config.commandsEnabled;
      }

      configManager.save({ commandsEnabled: newState });

      if (newState) {
        await ctx.reply(
          `✅ *Comandos Ativados!*\n\nO bot agora está respondendo a todos os comandos com prefixo \`${prefix}\`.`
        );
      } else {
        await ctx.reply(
          `🛑 *Comandos Desativados!*\n\nTodos os comandos foram pausados. Para reativar, envie \`${prefix}bot on\` ou \`${prefix}ativar\`.`
        );
      }
    }
  });

  // 2. Controle de Acesso Público: .publico / .pb [on/off]
  dispatcher.registerCommand({
    name: 'publico',
    aliases: ['pb', 'comandospublicos', 'public'],
    ownerOnly: true,
    description: 'Ativa ou desativa a execução de comandos por pessoas públicas',
    execute: async (ctx) => {
      const { args, prefix, configManager } = ctx;
      const opt = (args[0] || '').toLowerCase();

      let newState;
      if (['on', '1', 'ativar', 'sim', 'true', 'liberar'].includes(opt)) {
        newState = true;
      } else if (['off', '0', 'desativar', 'bloquear', 'nao', 'não', 'false'].includes(opt)) {
        newState = false;
      } else {
        // Toggle
        newState = !ctx.config.allowPublicCommands;
      }

      configManager.save({ allowPublicCommands: newState });

      if (newState) {
        await ctx.reply(
          `👥 *Comandos Públicos: ATIVADOS ✅*\n\nOutros usuários e membros de grupos agora podem utilizar os comandos permitidos do bot.`
        );
      } else {
        await ctx.reply(
          `🔒 *Comandos Públicos: DESATIVADOS ❌*\n\nO bot responderá única e exclusivamente a comandos enviados pelo dono.`
        );
      }
    }
  });
}
