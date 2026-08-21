#!/bin/bash
set -e
echo "=== CBScript Platform – UserLAnd Ubuntu setup ==="

sudo apt update
sudo apt install -y nodejs npm curl

NODE_VER=$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 18 ]; then
  echo "Node is too old or missing. Installing Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo ">>> Edit .env now and add your Google OAuth credentials:"
  echo "    nano .env"
  echo ""
fi

npm install
echo ""
echo "Setup done. Start with:  npm start"
echo "Then open http://127.0.0.1:3000 in your browser."
