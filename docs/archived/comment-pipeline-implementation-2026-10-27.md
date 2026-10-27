# Comment source and demand ownership — 2026-10-27

Local branch `codex/pr557-audit-repairs-20261012`; functional execution deferred.
Exact implementation checkpoints:

| Source | Tree | Change |
| --- | --- | --- |
| `2fba78f6d494e21b2c32e364f39fd1810a9b54d0` | `c55a60fb5d295f8806123bb1f0835cdc29533a65` | Parser-owned JS/TS spans, source/parser-qualified paired reuse, config demand |
| `481536c0518316acff8e32f1f578de685797eb73` | `f3b7cb0ecb74df12208ece53e63b5a5e8669beda` | Bounded lazy config parsing and compact exact token eligibility |
| `4437d9994f9553ec1f8aa6cf78e4a49248a26a80` | `609f09edc65a3200fff67c8e6cb0c4aa1539177e` | Private cache ownership precedes payload inspection |

JS/JSX and TS/TSX metadata now consume immutable original parser comment ranges,
preserving regex/template contexts and ECMAScript CR/LS/PS termination. Capture
retains parser/version/options, exact UTF-16 source identity and bounded spans;
no native handle escapes. Declaration attachment remains a separate JSDoc owner.
Prepared CPU contexts reuse capture; standalone paths load parsers lazily. Public
AST comment mutation cannot change the admitted inventory. Malformed/unsupported
sources remain explicitly heuristic; count/source admission failure is unavailable.
The text digest is lazy, avoiding a second unconditional full-source hash.

Paired extraction checks exact text even if a caller reuses a source key, and a
supplied AST must have a compatible parser identity. Unbranded cache payloads are
ignored before property inspection. Entry source/data remain visible for byte
accounting, and consumer dictionary changes do not reuse old tokens.

Ordinary code mode with `includeInCode=false` requests no config parsing. Config
consumers and deliberate paired-mode priming retain it. The private config owner
admits 32 candidates, 64 KiB per candidate, 256 KiB aggregate parser input and
20,000 fence-search lines. It reports bounded exclusion reasons separately from
syntax rejection, before oversized content assembly/vendor entry. JSONC/YAML/
TOML libraries load only after admission; required-library failures propagate.
Existing parser dialects remain. No synchronous preemption, complete structural
bound or fixed fence/source mapping is claimed by these changes.

Repository reads established that full per-comment `tokens` arrays had no
production consumer: chunk field tokenization ignores them and independently
uses clipped text. Their remaining reads were internal tests. Eligibility now
uses the same normalization/dictionary/stopword path in count-only mode, retaining
duplicates and stem cardinality without final token/sequence arrays. Actual field
consumers tokenize only their admitted UTF-8 prefix and current policy/dictionary;
no clipped result is cached across mutable dictionaries. Positive tests now run
the source through actual prose chunk/token owners rather than an unused array.
Classification/cache/signature version 4 invalidates old extraction products.

Twelve occurrence and ten work-admission cases are authored, **unexecuted**.
They include independently expected literal/template/line-ending spans, actual
metadata/reference consumption, source/parser/stale-cache negatives, disabled and
enabled config demand, byte/count boundaries, malformed versus budget results,
duplicate/stem thresholds and bounded clipped overlapping consumers. Original
license positives and warm paired dictionary behavior remain covered in source.
Static format/ESLint, syntax, config budget, generated inventory and whitespace
checks passed; shared module analysis found zero cycles. There are no measured
speedup, passing parser-call observations or consumer/replay qualification claims.

#1653/#1656 remain open. Non-JS language-owned lexical adapters, shared logical
fence content/maps under #1652/#1654, structural admission and the existing focused
consumer/replay/import checks remain required. See the
[current contract](../contracts/comment-occurrences.md) for exact scope and limits.
