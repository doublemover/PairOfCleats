# Sourcebot v3 discussion

- Source: https://github.com/sourcebot-dev/sourcebot/discussions/256
- Type: discussion

## Summary
- Release notes and architectural notes for Sourcebot v3.
- Highlights parallel indexing and durable queues for repo sync.

## PairOfCleats takeaways
- Use a job queue for predictable multi-repo indexing.
- Track indexing state and backpressure explicitly.
