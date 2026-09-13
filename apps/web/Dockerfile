FROM node:24.18.0-alpine AS base
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
ARG NEXT_PUBLIC_API_ORIGIN=http://localhost:4000
ARG NEXT_PUBLIC_API_MODE=live
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE
RUN pnpm --filter @companion/web build
EXPOSE 3001
CMD ["pnpm", "--filter", "@companion/web", "start"]
