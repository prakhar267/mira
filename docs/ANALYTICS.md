# Analytics

`packages/analytics` defines a small allowlisted event vocabulary and removes fields that could contain conversation text, memory content, email, authorization data, cookies, passwords, or tokens.

Product analytics should answer whether onboarding, chat, memory review, activities, privacy controls, and subscription surfaces work. They should not infer or monetize emotional vulnerability.

Production events need documented owners, purpose, retention, sampling, consent basis, and deletion behavior. Provider-usage records should capture model, latency, token/audio/image units, cost, and success state without storing raw private content.
