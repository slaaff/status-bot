/**
 * Comando de Menu Completo e Padronizado para o Status Bot
 * .menu, .ajuda
 */

export function registerMenuCommand(dispatcher) {
  dispatcher.registerCommand({
    name: 'menu',
    aliases: ['ajuda', 'help'],
    description: 'Exibe o catálogo completo de comandos do bot',
    execute: async (ctx) => {
      const prefix = ctx.prefix;
      const botName = ctx.config.botName || 'Status Bot Pessoal';

      const menuText = `🤖 *${botName.toUpperCase()}* • *CATÁLOGO DE COMANDOS*
💡 _Prefixo ativo: \`${prefix}\`_

⚙️ *STATUS (STORIES)*
• \`${prefix}status\` — Painel de status e estatísticas
• \`${prefix}status lista\` — Lista contatos bloqueados e selecionados
• \`${prefix}status todos\` — Ativa para todos os contatos
• \`${prefix}status selecionados\` — Ativa apenas para selecionados
• \`${prefix}status desativar <número>\` — Bloqueia contato do status
• \`${prefix}status ativar <número>\` — Desbloqueia contato
• \`${prefix}status add <número>\` — Adiciona aos selecionados
• \`${prefix}status del <número>\` — Remove dos selecionados
• \`${prefix}status zerar\` — Zera o contador de curtidas de status
• \`${prefix}visualizar\` — Apenas visualiza stories
• \`${prefix}curtir [emoji]\` — Só curte (preserva círculo verde)
• \`${prefix}ambos [emoji]\` — Visualiza e curte simultaneamente
• \`${prefix}desligar\` / \`${prefix}desativar\` — Desativa visualizador e curtidas
• \`${prefix}emoji <emoji>\` — Troca o emoji de curtida (padrão: 💚)

🎨 *FIGURINHAS*
• \`${prefix}s\` / \`${prefix}figurinha\` — Foto ou vídeo/gif (até 10s) para figurinha
• \`${prefix}sf\` / \`${prefix}semfundo\` — Cria figurinha com fundo removido via IA
• \`${prefix}toimg\` / \`${prefix}foto\` — Converte figurinha em foto comum

👥 *ADMINISTRAÇÃO DE GRUPOS*
• \`${prefix}abrir\` | \`${prefix}fechar\` — Abre ou fecha o grupo para envio
• \`${prefix}ban @membro\` — Remove participante do grupo
• \`${prefix}promover\` | \`${prefix}rebaixar\` — Gerencia administradores
• \`${prefix}hidetag <texto>\` — Notifica todos silenciosamente
• \`${prefix}marcar\` — Marca todos os membros em lista
• \`${prefix}infogp\` | \`${prefix}link\` — Dados e convite do grupo
• \`${prefix}antilink on/off\` — Bloqueador de links de outros grupos
• \`${prefix}antifake on/off\` — Bloqueador de números estrangeiros

🎭 *PRESENÇA FAKE*
• \`${prefix}digita\` / \`${prefix}grava\` / \`${prefix}online\` — Ativa presença fake
• \`${prefix}parar\` / \`${prefix}reset\` — Desativa presença fake

🔧 *SISTEMA & CONTROLE*
• \`${prefix}ping\` — Latência real e recursos do host
• \`${prefix}bot on/off\` — Liga/desliga comandos para todos
• \`${prefix}publico on/off\` — Libera/bloqueia uso para não-donos
• \`${prefix}restart\` — Reinicia os serviços do bot`;

      await ctx.reply(menuText.trim());
    }
  });
}
