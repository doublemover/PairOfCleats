# Zoekt Go package docs

- Source: https://pkg.go.dev/github.com/sourcegraph/zoekt
- Type: doc

## Summary
- Go API surface for building, loading, and querying Zoekt indexes.
- Exposes query parsing, scoring, and shard handling.

## PairOfCleats takeaways
- If we adopt Zoekt-like trigram indexing, map it to our query pipeline.
- Keep sharded index metadata so we can parallelize searches cleanly.
