# Original vector spool lifetime — 2026-10-28

Source `169b5aafb5f2b79a7e2d6a397eab9a87a9c0930b`, tree
`1f3e5990c1a3e5865007e30e76bad35ece3549d9`, and admission follow-up
`285c1799c423fd2df8a6f588256b775aa13cdb76`, tree
`f4cfffcf33dc5225391a1a3bfc242d53f73750a8`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; functional qualification pending.

The previous spool set `closed` before physical closure, recursively removed a
nonce path even after partial-construction close failure, mutated frozen errors,
used truthiness for failed writes and cached a rejected cleanup promise without
an explicit original-owner recovery path. Deferred mode work could later settle
while spool files still lacked their own closure observation.

The actual allocator now records directory identity and admits exactly three
ordinary private channel files. Each FileHandle immediately enters the existing
contained-file resource owner, capturing actual operations and closure before
verification/truncation. Accepted work drains before retirement; independent
descriptors close through bounded sibling settlement. A failed native close keeps
its original branded session. Explicit recovery can close that original async
handle; successful siblings are never closed again. Failed allocation/admission
cannot open another channel.

Scratch retirement follows original directory/file identity and confirmed
resource observations. It unlinks only admitted created files and removes the
empty original directory. Unknown children, replaced/shared objects and missing
identity proof remain protected; no recursive prefix cleanup or force path is
used. Metadata-only recovery does not repeat physical close or writes. Frozen
and falsey failures remain first failures, and truthful stats distinguish
retiring from actual closure/removal.

The mode retains actual deferred spool settlement alongside original native
work. Existing outer scheduler/provider cleanup attempts that retirement before
finalization. True original work alone cannot release cache ownership with open
spool files. Terminal receipt/diagnostic/text-cache errors now compose with the
original phase failure rather than mutating it or masking it in finally.

Fifteen independently selectable real-FileHandle cases are authored and **not
executed**: `indexing/embeddings/vector-spool-original-lifetime/*`. They cover
captured close, pending/failed close, independent siblings, explicit recovery,
failed construction/admission, metadata failure, unknown/replaced file/directory,
frozen/falsey writes, accepted-write drain, independently thrown observers,
deferred original work and unavailable allocation identity. No model, link,
elevation, native crash-status redo or benchmark was used.

Static format/ESLint, five affected JavaScript syntax checks, whitespace and
zero-cycle analysis completed for the main source; the admission follow-up
passed its format/two-file syntax/whitespace checks. No functional/child/native
fixture, benchmark or publication front gate ran. Dependency inputs remain the
verified locked-bootstrap inputs. Existing ordinal/generation, short-progress,
cancellation, full-runner/provider/cache/category and original/follow-up
qualification remain required. Thirty-two state/terminal and fifteen spool
controls total 47 authored cases in these ownership batches, all unexecuted.

#1267/#1325 retain broader route/quota/publication and full runtime qualification;
#1574 retains custom/external category registration and cleanup authority. A
private scratch owner does not grant saved-evidence or parent-cache deletion.
No overall issue classification or closure changes here.
