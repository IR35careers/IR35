#!/usr/bin/env bash
set -euo pipefail
cd /opt/ir35-worker
# --images prints only the image reference, never the resolved environment.
image="$(docker compose --env-file deploy.env -f docker-compose.yml config --images)"
if ! [[ "$image" =~ ^ghcr\.io/ir35careers/ir35-worker@sha256:[a-f0-9]{64}$ ]] && ! [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf '%s\n' 'Smoke check requires the reviewed pinned worker image.' >&2
  exit 1
fi
# No worker .env, secrets, Supabase access, queue, external network or employer.
docker run --rm --init --network none --memory 1g --pids-limit 256 --shm-size 256m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  "$image" node --import tsx services/application-worker/mock-ats-smoke.ts
