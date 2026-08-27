#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org/"
  exit 1
fi
( sleep 1; open http://127.0.0.1:8765 >/dev/null 2>&1 || true ) &
node server.js
