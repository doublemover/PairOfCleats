# Zoekt

- Source: https://github.com/sourcegraph/zoekt
- Type: repo

## Summary
- Fast trigram-based code search engine designed for large codebases.
- Ships indexer/searcher components and supports shard-based indexes.
- Supports query language features and boosts symbol definitions (ctags).

## PairOfCleats takeaways
- Add a trigram candidate generator to narrow regex and substring queries.
- Consider a service-mode indexer + query server split for large repos.
- Use symbol metadata as a ranking boost for definitions and exports.
