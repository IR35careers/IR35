#!/usr/bin/env bash
set -euo pipefail
# Cached environments must use the current lockfile, never stale dependencies.
node -e 'if(Number(process.versions.node.split(".")[0])!==22)throw Error("Select Node.js 22 in the cloud environment")'
npx --yes npm@11.19.0 ci --ignore-scripts
