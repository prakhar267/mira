# Memory system

Memory is the product's continuity layer, not an invisible transcript dump.

## Pipeline

```text
user message
  → candidate extraction
  → confidence and importance
  → contradiction/supersession check
  → inspectable memory record
  → hybrid ranking at response time
```

The current extractor recognizes durable preferences, named relationships, future events, and goals. Ranking combines lexical relevance, importance, recency, relationship relevance, retrieval history, and a small pin bonus. Superseded or deleted items are excluded.

Every memory carries provenance fields, confidence, timestamps, status, and pin state. The UI supports search, categories, pause/resume, add, edit, pin, and delete. Production embeddings can add semantic similarity through pgvector without changing the public memory contract.

The context budget is bounded so a large memory collection cannot crowd out the current conversation. Memory failure must never block ordinary chat.
