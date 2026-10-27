# WhatsApp Status Bot (Dedicado)

Bot ultraleve e isolado exclusivamente para visualizar e curtir Status (Stories) do WhatsApp automaticamente com suporte a múltiplos modos e pareamento via **QR Code**.

## Características
- **Zero interferência**: Ignora 100% de mensagens de terceiros, grupos, newsletters e chamadas.
- **Pareamento Simples via QR Code**: Escaneie direto no terminal com a câmera do seu WhatsApp.
- **Comandos apenas para o Dono**: Responde apenas a mensagens enviadas pelo próprio dono (`fromMe === true`).
- **Modos de visualização/curtida**:
  - `!visualizar` ou `.visualizar`: Apenas marca status como lido (`readMessages`), sem curtir.
  - `!curtir` ou `.curtir`: Apenas reage com emoji no status sem marcar como lido (mantém o círculo verde no celular).
  - `!ambos` ou `.ambos`: Visualiza e curte simultaneamente.
  - `!desligar` ou `.desligar`: Desativa o bot temporariamente.
  - `!emoji [emoji]` ou `.emoji [emoji]`: Altera o emoji de reação (padrão ❤️).
  - `!status` ou `.status`: Exibe status do bot, modo atual e contadores de visualizações/curtidas.

## Como Usar

### 1. Instalação
```bash
git clone https://github.com/slaaff/status-bot.git
cd status-bot
npm install
```

### 2. Pareamento com QR Code
Para parear e já registrar no PM2 (24/7):
```bash
npm run pair
```
Ou simplesmente:
```bash
npm start
```
Escaneie o QR Code que aparecerá no terminal com o seu WhatsApp (*Aparelhos Conectados > Conectar um aparelho*).

### 3. Rodar em Segundo Plano (PM2)
```bash
pm2 start index.js --name status-bot
pm2 save
```
