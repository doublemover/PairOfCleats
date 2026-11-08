# Complete function surfaces — 2026-10-28

**Unvalidated source:** `c8a7ae65c1e086c2d9dca95d26a4e038581b0261`, tree
`8cc586b28e484a31e31c08220c5111c83d51f0ff`; Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

The [complete-function implementation](context-function-implementation-2026-10-28.md)
now has explicit plain-text edit metadata and five additional unexecuted surface
cases. Text output labels a complete file/function and shows its original UTF-16
span, UTF-8 bytes, full-file source hash, independent function hash and index
generation. Explicit whole-file fallback remains visible. Ordinary excerpt output
is unchanged; no request flag or policy relaxation is added.

`context-pack/complete-function-surfaces/*` separates actual central CLI, HTTP,
MCP, repeated frozen-index assembly and human-readable output into bounded cases.
Each uses its own disposable source/index fixture and canonical unit validation.
The positive source is exactly one complete function; existing full-file and
unavailable-function negatives remain unchanged. Index file inventories/hashes
must remain unchanged after requests. The existing fixture Git initializer also
selects `windowsHide:true`, keeping that native helper from opening a console.

There are now **23 authored, unexecuted** complete-function cases: 18 source/parser/
contract controls and five surface controls. These are source additions, not
passing results. Format/ESLint, changed JavaScript syntax, config budget, command
inventory and whitespace checks pass. No functional fixture, child, server,
benchmark or publication front gate ran during this source wave.

Full task-policy/fidelity/source/resource/CLI/API/MCP qualification and corpus
patch outcomes remain required on the resulting candidate. #1125 exact target
tokenizer accounting and #1126 bounded selection remain separate source work.
