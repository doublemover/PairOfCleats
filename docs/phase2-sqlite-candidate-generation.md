# Phase 2 Design: SQLite Candidate Generation

## Goal
Use SQLite to generate candidate document sets for token, phrase n-gram, and char-gram matches while keeping scoring and rendering in `search.js`. This keeps ranking behavior consistent and centralizes index storage in the SQLite DB.

## Data flow
1) `search.js` tokenizes the query (camel/snake split + dictionary splitting).
2) Candidate generation runs against SQLite tables:
   - token_vocab/token_postings
   - phrase_vocab/phrase_postings
   - chargram_vocab/chargram_postings
3) JS scoring (BM25 + ANN/minhash) runs using the candidate set.
4) Rendering uses the same output path as file-backed search.

## Candidate generation

### Tokens
- Resolve token IDs from `token_vocab` by query tokens.
- Pull postings for those token IDs from `token_postings`.
- Build a per-query token index:
  - `vocab` array for the query tokens
  - `postings` arrays for only those tokens
  - `docLengths` from `doc_lengths`
  - `avgDocLen` and `totalDocs` from `token_stats`

### Phrase n-grams
- Generate 2-4 gram tokens from the query.
- Resolve phrase IDs in `phrase_vocab`.
- Fetch doc IDs from `phrase_postings`.

### Char-grams
- Generate 3-5 char-grams per query token.
- Resolve gram IDs in `chargram_vocab`.
- Fetch doc IDs from `chargram_postings`.

## SQL query shapes

### Token vocab
```sql
SELECT token_id, token
FROM token_vocab
WHERE mode = ? AND token IN (...)
```

### Token postings
```sql
SELECT token_id, doc_id, tf
FROM token_postings
WHERE mode = ? AND token_id IN (...)
ORDER BY token_id, doc_id
```

### Doc lengths
```sql
SELECT doc_id, len
FROM doc_lengths
WHERE mode = ?
```

### Phrase vocab + postings
```sql
SELECT phrase_id, ngram
FROM phrase_vocab
WHERE mode = ? AND ngram IN (...)
```
```sql
SELECT phrase_id, doc_id
FROM phrase_postings
WHERE mode = ? AND phrase_id IN (...)
ORDER BY phrase_id, doc_id
```

### Chargram vocab + postings
```sql
SELECT gram_id, gram
FROM chargram_vocab
WHERE mode = ? AND gram IN (...)
```
```sql
SELECT gram_id, doc_id
FROM chargram_postings
WHERE mode = ? AND gram_id IN (...)
ORDER BY gram_id, doc_id
```

## Query chunking
SQLite has a variable limit per statement. Queries that use IN (...) are chunked to avoid exceeding the limit (default chunk size 900).

## Fallback behavior
- If SQLite tables are missing, `search.js` falls back to file-backed indexes unless `--backend sqlite` is forced.
- If no tokens or postings match, candidate sets fall back to null (global search).

## Caching
- `doc_lengths` and `token_stats` are cached per mode in memory to avoid re-reading for each query.

## Tradeoffs
- Candidate generation uses DB queries but scoring remains JS-side to preserve behavior.
- Dense vector and minhash data are still loaded into memory in phase 2.

## Testing
- Update smoke tests to check required SQLite tables.
- Add parity tests in a later phase to compare SQLite vs file-backed outputs.
