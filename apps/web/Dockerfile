FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/ai packages/ai
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/ui packages/ui
RUN pnpm --filter @companion/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@companion/web", "start"]
