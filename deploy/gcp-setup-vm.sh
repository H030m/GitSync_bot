#!/bin/bash
set -euo pipefail

echo "=== Installing Docker ==="
apt-get update
apt-get install -y docker.io

echo "=== Creating bot user ==="
if ! id discordbot &>/dev/null; then
  useradd -r -m -d /opt/discord-github-bot discordbot
fi
usermod -aG docker discordbot

echo "=== Building Docker image ==="
cd /opt/discord-github-bot
docker build -t discord-github-bot -f deploy/Dockerfile .

echo "=== Installing systemd service ==="
cp deploy/discord-github-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable discord-github-bot

echo "=== Done ==="
echo "Make sure /opt/discord-github-bot/.env is configured, then run:"
echo "  systemctl start discord-github-bot"
