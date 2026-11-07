# Stable dependency refresh and Windows CI repairs

The focused upgrade batch passes **85/85 distinct affected fixtures**, without
retries, skips, timeouts or native-status redo. Rust 1.99.1 passes **152 tests**,
strict Clippy and formatting. The [machine receipt](windows-stable-upgrades-2026-10-29.json)
retains all failed attempts and subsequent rechecks, source/dependency/native
hashes, raw-log hashes and the previous hosted run's exact source identities.
The parent is `cc79b19cc750e17ead70a33dc9e45581342ffd95`; changed-file SHA256 values
identify the tested source. Author-workspace `.tmp/` paths are historical evidence.
Implementation head: `8462b5801974ec0944e7215d5d5d3b283fdfa243`.

## Delivered changes

- Refresh 49 direct dependency ranges against official stable metadata. Major
  changes include Babel 8, Astro 4, GraphQL 17, LanceDB 0.40, Arrow 21,
  MessagePack 2, queue 10 and JSON-RPC 10. Compatible transitive npm and Cargo
  resolutions are refreshed. Maintained `@prometheus-io/client` replaces
  deprecated `prom-client`; its actual bounded-cardinality worker metrics pass.
- Retain TypeScript 6.0.3 explicitly: TypeScript 7.0.2's native package omits the
  JavaScript compiler API and `tsserver`; its compatibility package still omits
  `tsserver`. The current embedded provider and language server need both.
  Upstream transitive constraints remain intact. LanceDB uses its own Arrow
  instance, and its optional Transformers/OpenAI SDKs use current scoped versions.
- Port all Tree-sitter ownership/shutdown repairs to 0.25.1 and Transformers
  repairs to 4.3.2. Ten independent fresh parser processes pass natural and
  interrupted worker shutdown, while callback, language and range errors retain
  their strict assertions. Patch reverse/reapply controls pass.
- Retire the DOCX patch after proving pristine 9.15.0 ESM/CommonJS bundles produce
  real ZIP documents with zero browser-storage reads or warnings. Mammoth CLI,
  conversion and image controls pass with modern argparse 3.0.4.
- Isolate Windows addons from Node executable PGO flags in node-gyp, alongside
  upstream LTO isolation. The regression fails before the repair and passes
  afterward; cold locked compilation no longer emits MSVC `D9002` or linker
  `LNK4044`. Official Node headers are unchanged.
- Use the official ES-module lexer's minimal API for its unchanged flat-record
  consumer contract; initialize its new function API. Update exact Astro,
  GraphQL and compiler version guards and semantic producer versions. Positive
  content comparisons and unsupported-version negatives remain.
- Select ast-grep 0.51.0 with all seven publisher asset hashes/sizes. A real Windows
  managed install verifies the official archive and performs the required local
  structural match, with a confirmed resource-settlement receipt.

## Native Windows path and lifetime repairs

The actual LanceDB writer failed its original custom-column roundtrip on the
upgraded backend. Minimal controls prove a long native write path fails with
Win32 error 3 while the same operation at a short root succeeds. A `\\?\` URI
does not repair the native failure. Writes now use a compact `.lb-` directory
inside the same index generation. Only a fully closed payload moves into the
unchanged UUID publication layout; manifest, journal, rollback and recovery
contracts remain intact. The original six array/stream and custom-column
combinations pass with exact schema, vector values, document-ID holes and ANN
ranking assertions.

The retained writer owner closes tables before their connection. Failed or
unconfirmed shutdown preserves the exact original handles, observer, cause and
files, and offers explicit reconciliation. Cleanup compares admitted directory
identities and refuses a replacement root. Delayed Arrow consumption,
publication/rollback faults, query lifetimes and pending close controls pass.
This repairs avoidable staging overhead; unrestricted long user-root support
still requires an upstream native qualification.

Windows publication also accepts different namespace spellings of the same
ordinary directory after checking every path component and matching device/file
identity. The verbatim-path regression fails before the repair and passes after;
foreign generation/index roots remain rejected. No new local symlinks are made.
The previous hosted 8.3-path failure needs its original hosted recheck; an exact
8.3 cause has not been proved from its JavaScript diagnostic alone.

## Hosted CI follow-up

Run `40814855277` at the parent passed policy, gate and Linux native workflows.
It exposed strict Clippy's now-repaired optional-ID unwrap, missing explicit
workspace trust in real Csharp/PHPactor launch steps, a macOS Unix-socket name
that exceeded its native limit, Windows publication identity rejection and two
Windows native-workflow timeouts. Workspace trust is explicit in CI's launch
environment; product trust rejection remains covered. Socket names are compact
inside unique private temporary roots; FIN/EPIPE and natural-exit controls stay.

The Windows artifact proves both timed-out UI jobs completed their actual work,
restored the terminal and reaped children before aggregate fixture overhead
crossed 30 seconds. Build/search and validate/search now confirm the real UI's
already-selected repository scope instead of retyping it, and assert the exact
emitted repository request. Other cases retain typed-path/paste coverage. Both
pass against the new Rust 1.99.1 debug binary in 20.6 and 23.6 seconds; the public
CLI searches and all result assertions remain. No deadline was increased.

## Setup, publication and remaining work

Fresh `npm run bootstrap:ci` on Node 26.13.0/Windows x64/ABI 147 succeeds. Final
native verification confirms **37 packages, 33 language routes, seven patches,
25 targets and 58 hunks**. npm audit reports **zero vulnerabilities**. One upstream
`prebuild-install@7.1.3` deprecation remains through Perl/optional Zstandard; setup
is not warning-free. No compiler/linker warnings remain.

All eight publication checks pass, including **40/40 gate fixtures**. The machine
receipt retains the repaired roadmap date/size and patch-whitespace check failures. This
focused batch does not rerun the entire deep suite. The historical checkpoint-305
catalog still has 25 original failures; new hosted reruns, four remaining P1
acceptances, real-model evaluation, optional sqlite-vec and release qualification
remain separate. Linux/macOS execute in hosted CI only; WSL is not used.
