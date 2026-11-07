# Comment, tokenization and embedding handoff repairs

Focused Windows checks pass in three source-bound groups: **56/56** comment,
HTML, JSONC and tokenization cases at `38847da10`; **six** embedding identity
cases at `eb4cd0c68`; and the repaired handoff plus **ten** Stage3 controls with
the launch-environment repair committed at `5b3eac58e`. The handoff receipt
records the exact working-file hashes verified against that commit. No failures,
timeouts or skips remain in these groups. All use one job, one indexing thread,
30-second fixture deadlines, zero retries and native-status redo disabled.

These checks qualify **12 additional original failures**, leaving **25** of the
partial checkpoint-305 campaign's 46 failures. The
[durable receipt](windows-comment-and-handoff-failure-repairs-2026-10-28.json)
preserves original failures, every outcome, source identities and coverage:

- **Rust refusal coverage:** a supplied source-owned comment product now reaches
  admission even when its input has no literal comment markers. A raw-string
  hash-budget refusal remains explicitly unavailable instead of disappearing in
  the marker prefilter. The cheap path remains for callers without a product.
  `COMMENT_CLASSIFICATION_VERSION9` invalidates earlier extraction receipts.
- **JSDoc refusal coverage:** an associated oversized documentation comment keeps
  its parser-proven range and budget reason. Standalone declaration association
  therefore reports unavailable rather than absent. Ordinary comments are
  identified before the documentation budget check. No oversized comment is
  parsed; existing limits, exact association, parser/source ownership, syntax
  precedence, writer schema, prototype-key and tamper controls remain.
  `JAVASCRIPT_RELATIONS_VERSION6` invalidates earlier semantic meaning.
- **HTML and JSONC fixtures:** canonical collector entries compare in canonical
  order while metadata retains its independently asserted document order. JSONC
  compatibility timing uses an explicit internal parser-factory dependency;
  replacing global `JSON.parse` could not affect the already captured parser.
  The original 30 ms refusal, real parsing, deep-data compatibility and strict
  negative assertions remain. Injected parsers cannot claim the built-in parser's
  identity. No public configuration surface changes.
- **Punctuation and line reuse:** unchanged direct/stream cases preserve the
  20,000-token allowance, exact sequence, statistics, MinHash and TF postings.
  The production fixture supplies actual source and fixture dictionary receipts,
  proves reuse for an admitted window, and retains the original oversized input
  as an asserted inline fallback. Per-line/window memory admission is unchanged;
  oversized lines no longer masquerade as successful cache reuse.
- **Embedding authority:** fixture builds use the selected cache category's
  canonical repository/generation namespace. Late-binding assertions use the
  same canonical path identity as the producer, retaining all selection, mode,
  generation, immutability and invalid-input controls. This exposed a production
  defect: Stage3 storage admission ignored the supplied launch environment and
  used ambient process settings. It now snapshots that environment and supplies
  it to the existing storage owner. Direct and queued handoff pass with conflicting
  ambient cache settings; an unselected repository cache root still fails.
  Preflight and fresh-cache full-build/explicit-Stage2 single-queue controls pass.

All eight publication checks pass, including **40/40 gate cases**. These are
focused checks, not a new full-suite campaign. Earlier source-bound passing
groups were not rerun after unrelated fixture/Stage3 changes; the receipt records
the intervening files. The stopped campaign and original failure catalog remain
intact. Native crash attribution, remaining failures and unrun fixture acceptance
remain open. Raw `.tmp/` paths describe historical author-workspace evidence.
