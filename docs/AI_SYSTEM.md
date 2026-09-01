# AI system

`packages/ai` defines provider-neutral chat contracts, deterministic mock responses, context construction, memory selection, and safety assessment.

For each response, the context engine assembles:

1. companion identity and relationship mode;
2. user profile and interests;
3. recent messages;
4. a bounded, ranked memory set;
5. current time, timezone, mood, and topic;
6. stable safety and response-style instructions.

The mock provider streams a deterministic response token-by-token. It proves UI streaming and failure isolation without transmitting private content. A production provider must implement the same interface, enforce timeout and token budgets, record cost metadata without raw text, and fail back to a safe degraded response.

Model outputs are never treated as authorization, billing truth, or a database mutation by themselves. Structured outputs must be validated before use.
