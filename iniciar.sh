#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "Iniciando o Status Bot..."
while true; do
  node index.js
  echo "Status Bot encerrou. Reiniciando em 5 segundos... (Pressione CTRL+C para parar)"
  sleep 5
done
