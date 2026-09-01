# Database

`packages/db/prisma/schema.prisma` defines the normalized PostgreSQL target. It covers identity and consent, companions and relationships, conversations and summaries, memories and sources, future events and nudges, activities and journals, media, wallet/store ownership, subscriptions and entitlements, safety events, analytics, provider usage, and feature flags.

All user-owned records are scoped by `userId`; companion-owned records also carry `companionId`. Memory vectors use pgvector. Commerce changes are modeled as ledger entries rather than mutable balances alone.

The current runtime uses `InMemoryCompanionRepository` and deterministic seed data. Before production, implement the Prisma repository, migrations, transactional idempotency, backups, restore tests, encryption/key rotation, row-level authorization checks, retention jobs, and deletion evidence.
