# Frontmatter content ownership

This source behavior and its eight fixtures are unvalidated.

`detectFrontmatter` retains its delimiter-inclusive `start`/`end` and legacy
LF-normalized `raw` display value. It additionally exposes `contentStart` and
`contentEnd`: an original-source UTF-16 half-open interval after the opening line
terminator and before the closing delimiter line. CRLF remains CRLF in that
interval. Empty interiors produce no config segment; missing closing delimiters
produce no frontmatter admission.

Markdown config segments use the exact interior as parser input. Their metadata
retains the broad container range and extraction policy
`markdown-frontmatter-content-v1`. Ordinary prose frontmatter retains its broad
container and existing opt-in behavior. Non-embedded config segments remain
outside default prose-mode admission. No default route or public option changes.

The contiguous interval uses existing exact linear chunk/VFS mapping; it does
not need prefix removal, a synthetic view or a new map kind. JSON/TOML delimiter
lines cannot reach the config parser. Segment identity includes the extraction
policy when present; existing callers without a policy retain their UID framing.
Source chunking producer version 35 also enters file parse dependency signatures,
so old cached extraction and semantic replay cannot preserve earlier meaning.

Eight authored `indexing/segments/frontmatter-content-ownership/*` cases cover
actual JSON key/TOML section chunks, exact authored offsets, original CRLF,
empty/missing closes, prose separation, policy-bound UIDs and actual VFS document/
target reconstruction. They have not run. Wrapped Markdown/comment fences remain
separate work: their piecewise content cannot use this contiguous interval's
constant-offset authority. No completion claim for #1652/#1654 is implied.
