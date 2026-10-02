# syntax=docker/dockerfile:1.7
# One Dockerfile, two runtime targets: `web` (Next.js standalone) and `worker` (BullMQ).
#   docker build --target web -t slotkeep-web .
#   docker build --target worker -t slotkeep-worker .
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# Dependencies layer: only manifests + Prisma schema, so code edits don't bust the install cache.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/infra/package.json packages/infra/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG SENTRY_RELEASE=""
ENV SENTRY_RELEASE=${SENTRY_RELEASE} NEXT_OUTPUT=standalone
RUN pnpm --filter @slotkeep/db generate \
 && pnpm --filter @slotkeep/web build \
 && pnpm --filter @slotkeep/worker build

# ---- web: Next.js standalone server (~ only traced files) ----
FROM ${NODE_IMAGE} AS web
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 SERVICE_NAME=web
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- worker: bundled entry + workspace node_modules (also runs migrations/seed) ----
FROM base AS worker
ENV NODE_ENV=production SERVICE_NAME=worker WORKER_HEALTH_PORT=3001
COPY --from=build /repo /repo
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]
