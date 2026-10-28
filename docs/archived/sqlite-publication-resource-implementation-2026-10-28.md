# SQLite replacement and recovery ownership — 2026-10-28

Source `244cd6ddd8086c1ffc280c1c225cfa4772592b32`, tree
`dfc2287e19917d4cef20f3bfcf95fcd126c6d5ac`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

Replacement previously classified rename errors before confirming original
resource settlement, allowing pending ENOENT/EXDEV/EPERM to reach ordinary
fallback or restoration. Successful rename/removal/copy results were discarded.
The actual owner now requires their original settlement before advancing to
promotion, deletion fallback, restoration or backup retirement. Pending work
stays with its actual namespace owner and preserves staging/backup evidence;
metadata-only recovery does not replay filesystem mutation. Sidecar retirement
still drains every already-admitted sibling.

The rollback handler also mutated `restoreError.message` and threw only that
error, masking promotion failure and failing on frozen errors. Shared error
composition now preserves exact primary and restoration causes, including
falsey values, without changing either. Ordinary confirmed promotion failures
retain existing backup restoration and cross-volume refusal behavior.

Thirteen new `storage/sqlite/publication-resource-ownership/*` controls cover
pending ENOENT/EXDEV/EPERM, successful promotion/backup/removal/copy/sidecar
ownership, independent diagnostic inspection, frozen/falsey restore failure,
healthy replacement and healthy restoration. They use tiny real files and the
actual replacement/session owners, asserting retained bytes, admitted-operation
counts, category protection and metadata-only recovery. Existing native/WAL/SHM,
backup/fallback and sidecar fixtures remain unchanged. **All new controls and
affected existing fixtures are unexecuted.**

Format/ESLint, two JavaScript syntax checks, static inventory and whitespace
checks passed. No native operation, functional fixture, child or publication
gate ran. Dependencies are unchanged. These changes do not qualify Windows
locked-file behavior, current-candidate native/CLI/MCP acceptance, custom
producer/deletion registration or crash-atomic publication. #1267/#1574 remain
partial.
