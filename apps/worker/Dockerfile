FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile
COPY apps/worker apps/worker
COPY packages/config packages/config
CMD ["pnpm", "--filter", "@companion/worker", "start"]
