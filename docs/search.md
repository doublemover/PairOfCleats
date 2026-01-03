# Search Pipeline

This document summarizes the query pipeline and the fast prefilter stages used before exact matches.

## Tokenization

- Code search keeps punctuation tokens (examples: `&&`, `=>`, `::`).
- Prose search applies stop-word removal and stemming; code search does not.
- Query parsing preserves punctuation tokens so symbol-only queries can match code.

## File Filter Prefilter (Substring/Regex)

When `--file` or `--path` filters are used, the filter index builds file-name chargrams. The filter stage:

1. Extracts a literal substring from substring filters or the longest literal run from regex filters.
2. Builds chargrams for that literal and intersects candidate file IDs using the chargram index.
3. Applies the original substring or regex on each candidate file path to verify exact matches.

This prefilter is advisory only: it narrows candidates but never skips the final exact match. Regex filters with no stable literal segment skip the prefilter and run exact matching on all candidates.

## Limits

- Chargram prefilter is case-insensitive; case-sensitive file filters are still enforced during the final exact match step.
- Very short substrings (shorter than the configured chargram size) do not benefit from the prefilter.
