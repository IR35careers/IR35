#!/usr/bin/env bash
set -euo pipefail
# Run in the repository root. No API key, production credential or paid service.
node -e 'if(Number(process.versions.node.split(".")[0])!==22)throw Error("Select Node.js 22 in the cloud environment")'
npx --yes npm@11.19.0 ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
npm run typecheck
npm run lint
npm run test:unit
npm run test:legacy
