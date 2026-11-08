# Frontmatter parser/source repair — 2026-10-27

Source `08fe8b40ba060e7ab0531111c62279f62b96cab8`, tree
`8e4f2efe4ba27c6ad71439ade63321af1829538f`, branch
`codex/pr557-audit-repairs-20261012`. Functional execution is deferred.

The prior frontmatter config segment covered opening and closing delimiter lines.
TOML/JSON consumers therefore received text different from the actual config
interior. The shared detector now reports exact original `contentStart`/`contentEnd`
alongside the unchanged broad container and legacy normalized display value.
Markdown config segments use that interior, retaining real LF/CRLF and original
UTF-16 offsets. Empty interiors emit no config segment; missing closes remain
unadmitted. Prose frontmatter still uses its broad opt-in container, and default
prose mode still excludes non-embedded config segments.

The existing contiguous linear chunk/VFS owner can map this input exactly. No new
artifact map kind, transformed text or synthetic constant offset was introduced.
Segment UID construction optionally binds the extraction policy while preserving
old callers' framing. Shared source chunking producer advances 34→35 and is now
included in file parse dependency signatures as well as semantic replay policy.
Old extraction caches therefore cannot supply the previous parser view.

Eight `indexing/segments/frontmatter-content-ownership/*` cases are authored,
**unexecuted**. They require actual JSON key/TOML section chunks and authored
offsets, original CRLF, missing/empty controls, independent prose admission,
policy-qualified identities and actual VFS document/target reconstruction.
Format/ESLint, changed-source syntax, config budget, generated inventory and
whitespace checks passed; shared module analysis found zero cycles.

#1652 remains open for wrapped/list/indented fenced content, piecewise canonical
map/VFS/semantic integration and all original qualification. #1654's separate
comment fence mapping is still required. The
[frontmatter contract](../contracts/frontmatter-content.md) records this scoped
source behavior; no full issue, native, performance or suite pass is claimed.
