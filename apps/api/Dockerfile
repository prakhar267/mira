FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/ai packages/ai
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @companion/api build
EXPOSE 4000
CMD ["pnpm", "--filter", "@companion/api", "start"]
