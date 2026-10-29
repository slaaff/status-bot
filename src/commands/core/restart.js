/**
 * Comando de Reinicialização Segura do Bot
 * .restart, .reiniciar, .reboot
 */

export function registerRestartCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'restart',
    aliases: ['reiniciar', 'reboot'],
    ownerOnly: true,
    description: 'Reinicia o processo do bot',
    execute: async (ctx) => {
      await ctx.reply(
        '🔄 *Reiniciando o Bot...*\n\nAguarde cerca de 5 segundos para a reconexão automática.'
      );

      // Garante flush de arquivos pendentes antes de sair
      ctx.configManager.flush();
      ctx.storeManager.flush();

      setTimeout(() => {
        process.exit(0);
      }, 1500);
    }
  });
}
