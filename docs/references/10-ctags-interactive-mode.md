# Universal Ctags interactive mode

- Source: https://docs.ctags.io/en/latest/interactive-mode.html
- Type: doc

## Summary
- Documents interactive mode for long-lived ctags processes over stdio.
- Supports incremental symbol queries without restarting the tool.

## PairOfCleats takeaways
- Use a long-lived ctags process to reduce per-file startup cost.
- Stream JSON responses into the indexer pipeline.
