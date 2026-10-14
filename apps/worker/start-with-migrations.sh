#!/bin/sh
# Container entrypoint for hosts without a pre-deploy step (Render free instances): apply pending
# migrations, then replace this shell with the worker so it receives SIGTERM directly.
# Run from the repo root: sh apps/worker/start-with-migrations.sh
set -e
pnpm --filter @slotkeep/db migrate:deploy
exec node --enable-source-maps apps/worker/dist/index.js
