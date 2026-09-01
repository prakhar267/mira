# Luma memory architecture

## Principles

Memory creates continuity but remains inspectable, correctable, exportable, and deletable. Chat must continue if extraction, embedding, retrieval, or follow-up scheduling fails.

## Pipeline

```text
message → safety filter → candidate extraction → entity resolution
→ contradiction/supersession → confidence + importance → user-visible memory
→ hybrid retrieval → bounded companion context → optional follow-up
```

Categories are About You, People, Favorites, Work, Goals, Relationships, Important Dates, Experiences, Inside Jokes, Preferences, and Things To Follow Up.

The graph uses `MemoryEntity` nodes and typed `MemoryRelationship` edges, for example user → friend → Aman and Aman → lives_in → Bengaluru. Source message hashes provide provenance without copying raw private text into analytics.

## Retrieval

Retrieval combines semantic similarity, lexical overlap, importance, recency, relationship relevance, retrieval history, and pin state. A strict token budget prevents memory from crowding out the current conversation. Uncertain facts are phrased tentatively.

## Future events

Time expressions create reviewable future-event candidates. Confirmed events may schedule an opt-in nudge in the user's timezone and outside quiet hours. Completion creates a follow-up candidate and, when meaningful, a Moment.

## Personalization

Explicit corrections such as “don't call me baby” immediately update preferences and outrank inferred behavior. Response length, emoji use, question frequency, nickname choice, affection, and proactive cadence remain visible and editable.
