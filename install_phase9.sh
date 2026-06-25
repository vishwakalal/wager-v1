#!/bin/bash
set -e
cd "$(dirname "$0")/backend"
npm install @nestjs/websockets@^10.4.15 @nestjs/platform-socket.io@^10.4.15 socket.io@^4.8.1 stream-chat@^9.9.0 --legacy-peer-deps
echo "Backend packages installed."
cd ../frontend
npm install expo-linking@~7.1.4 socket.io-client@^4.8.1 --legacy-peer-deps
echo "Frontend packages installed."
cd ..
echo "All Phase 9 packages installed. Now run:"
echo "  cd backend && node_modules/.bin/prisma migrate deploy && node_modules/.bin/prisma generate"
echo "  npm run typecheck"
