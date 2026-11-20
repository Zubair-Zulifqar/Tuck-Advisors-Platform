# Background worker: research jobs, automations, follow-ups, outreach & newsletter delivery, retention.
FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
COPY apps/workers/package.json apps/workers/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/engine/package.json packages/engine/
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --chown=node:node . .
USER node
CMD ["npx", "tsx", "apps/workers/src/index.ts"]
