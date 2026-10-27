# WhatsApp Status Bot (Dedicado)

Bot ultraleve e isolado exclusivamente para visualizar e curtir Status (Stories) do WhatsApp automaticamente com suporte a múltiplos modos.

## Características
- **Zero interferência**: Ignora 100% de mensagens de terceiros, grupos, newsletters e chamadas.
- **Comandos apenas para o Dono**: Responde apenas a mensagens enviadas pelo próprio dono (`fromMe === true`).
- **Modos de visualização/curtida**:
  - `!visualizar` ou `.visualizar`: Apenas marca status como lido (`readMessages`), sem curtir.
  - `!curtir` ou `.curtir`: Apenas reage com emoji no status sem marcar como lido (mantém o círculo verde no celular).
  - `!ambos` ou `.ambos`: Visualiza e curte simultaneamente.
  - `!desligar` ou `.desligar`: Desativa o bot temporariamente.
  - `!emoji [emoji]` ou `.emoji [emoji]`: Altera o emoji de reação (padrão ❤️).
  - `!status` ou `.status`: Exibe status do bot, modo atual e contadores de visualizações/curtidas.

## Como rodar no PC / Linux / Termux

```bash
git clone https://github.com/slaaff/status-bot.git
cd status-bot
npm install
npm start
```
