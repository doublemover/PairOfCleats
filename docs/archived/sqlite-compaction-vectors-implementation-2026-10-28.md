# SQLite compaction vector bytes and metadata — 2026-10-28

Source `b6652070b27a485fe7ee3180ff449f41539949e8`, tree
`96f67d4236043871aed4266b44e85af39379efab`, branch
`codex/pr557-audit-repairs-20261012`. Local/unpublished, functionally unqualified.

Compaction's row counts and chunk identities could not detect equal-count vector
permutation or metadata corruption. The actual compactor now independently
witnesses original dense bytes against planned reassigned chunk IDs and checks
its actual output after VACUUM, before replacing the original database.

An original native read transaction assigns ordinals across all chunks in the
existing file/start/old-ID order, then joins optional/partial dense rows. It keeps
document ID zero and applies no +1 conversion. The original dense count must
equal mapped rows, so an orphan cannot be silently discarded. Mode/ID/BLOB bytes
use a domain-separated, length-delimited SHA256; source non-BLOB vectors fail.
Dense metadata has a separate digest after the existing scale/quantization
default normalization. Model/scale/quantization changes remain observable.

Chunk and vector hashing share the extracted original cursor owner, retaining
its actual methods, bounded resource observations and independent return failures.
Binary fields have a distinct encoding; finite fractional metadata uses explicit
IEEE double bytes. There is no second corpus map or unordered hash accumulator.
SQL ordering/window and streaming hash costs still require measured qualification.
No produced semantic meaning, Node pin, dependency, public option, schema or
compaction result JSON changed; validation strengthens preservation checks.

Nine additional actual-native controls cover corrupted copied vectors,
equal-count permutation, missing output vectors, model/scale/quantization changes,
orphan source vectors, wrong native storage type and original source-query failure.
Existing positive planned-renumbering controls compare actual chunk/vector pairs;
all corruption cases retain the original file's bytes. The earlier orphan-output
negative now expects the stronger vector-identity owner that detects it first.
Every original assertion/control remains. **All 25 compaction source controls,
the cursor controls and affected original suites are unexecuted.**

Format/ESLint, five changed JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No project functional
fixture, native operation, child, debugger, install or benchmark ran.

#284 remains partial. This is preservation of the compaction source's native
vectors, not original artifact/bundle/source/model correctness or validity. Full
payload/file/hash and bundle/incremental identity, final publication/generation
replay and actual correctness/resource/performance qualification remain. Source
inventory is unchanged: 482 pending / 146 partial / 90 unresolved of 718 open.
