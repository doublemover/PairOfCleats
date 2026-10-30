# Source classification reconciliation — 2026-10-28

PR #572 checkpoint `138d9d9e560963506d6fc0991e5df6ec39de9f28` was updated and
read back at `2026-10-28T07:53:42Z`: 64,570 body characters, all 718 live open
issues represented once, qualified closing references unchanged. The PR retains
published head `adbcaf777ce91642bb0a60de892171d8c3a529f7`; all 120 local commits
remain unpublished and functionally unqualified. An independently verified
96,592-byte incremental Git bundle preserves commits 109–120 in the historical
author workspace, requiring checkpoint `0d0b3409b87a668b57d7806c5133ae3d2cb05f46`.
That ignored local backup is not promised in clean checkouts.

Further owner review found three stale unresolved classifications. No additional
runtime implementation or functional execution was needed to establish their
existing source changes:

| Issues | Existing source and concrete proof | Required qualification |
| --- | --- | --- |
| #672, #681 | `1515ad0a8ebfb7c3125ffd5570f3e86e79133837` removed the five proven-unused roots and three install permissions through supported lock regeneration. Current manifest/lock entries remain absent; Lua selects scoped grammar 0.4.1. Arrow's peer provision and jsdoccomment/ESLint esquery users remain. The curated ownership inventory and original full-graph/dynamic/CLI proof are in the [dependency receipt](dependency-ownership-implementation-2026-10-27.md). | Authored ownership assertion plus actual Lua/parser/MDX/managed structural CLI, PATH-rg/filesystem discovery, LanceDB and original/follow-up acceptance. Locked bootstrap has run successfully, including after the later direct-tokenizer declaration; setup is not runtime qualification. |
| #668 | `18a11375463acdf2ed74dfa6ab2451c8a8703972` replaced whole-chunk JSDoc tag scanning with private source-parser comment ranges, declaration association and bounded already-locked jsdoccomment/type-pratt parsing. Current owners retain the structured dialect/raw type policy, optional/default/rest/dotted names, nested types, stronger AST precedence and explicit documentation states. The [source receipt](javascript-documentation-implementation-2026-10-27.md) maps 21 authored cases. | Execute those cases and existing parser/declaration/flow/replay/import/consumer and original/follow-up acceptance. No latency/semantic-consumer qualification is inferred from source inspection. |

These move from unresolved to source-implemented/qualification-pending. Current
owner-queue totals become **476 pending, 144 partial, 98 unresolved** out of 718.
All three issues remain open. Historical classifications and receipts retain
their original source/check scope; current rows point to the source evidence.
The PR's prior 120-commit snapshot is preserved as dated evidence; its next
scheduled metadata refresh will include subsequent source reconciliation.
