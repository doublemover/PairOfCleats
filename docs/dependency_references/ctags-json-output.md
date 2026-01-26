# Universal Ctags JSON output

- Source: https://docs.ctags.io/en/latest/man/ctags-json-output.5.html
- Type: doc

## Summary
- Describes JSON lines output for symbols, including name/kind/scope fields.
- Suitable for streaming symbol extraction without large JSON blobs.

## PairOfCleats takeaways
- Prefer JSONL symbol extraction to avoid memory spikes.
- Align symbol schema with existing chunk metadata fields.
