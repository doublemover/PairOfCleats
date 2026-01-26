# Zoekt query syntax

- Source: https://sourcegraph.com/github.com/sourcegraph/zoekt/-/blob/doc/query_syntax.md
- Type: doc

## Summary
- Documents Zoekt query operators, filters, and regex support.
- Supports file/path, repo, language, and case sensitivity modifiers.
- Emphasizes narrowing queries to keep search fast.

## PairOfCleats takeaways
- Expand query language with cheap filters that prune candidate sets.
- Support regex-to-ngram prefilters before exact matching.
