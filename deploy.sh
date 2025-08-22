#!/usr/bin/env bash
set -e

# Build & deploy via Docker (jika pakai Railway CLI/registry sendiri)
echo "Building image..."
docker build -t whatsapp-bot:latest .

echo "Run local (dev) -> http://localhost:8080"
docker run --rm -it -p 8080:8080 -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth -v $(pwd)/sessions.json:/app/sessions.json whatsapp-bot:latest
