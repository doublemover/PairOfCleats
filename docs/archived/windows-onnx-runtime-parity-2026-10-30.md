# Windows ONNX native runtime parity — 2026-10-30

The public direct-ONNX MiniLM adapter crashed with `0xC0000005` on Node
26.13.0, Windows x64, ABI147. Transformers4.3.2 loaded its nested ORT1.30.0
first; the direct provider then loaded the root ORT1.31.1 addon. Independent
imports returned successfully, but session creation failed. The original
37-package/33-route setup verification therefore did not establish this mixed
consumer lifecycle.

CDB launched the actual child with child-process debugging enabled. Its loaded
module inventory identifies the nested1.30.0.909 `onnxruntime.dll` and both
addons. The second-chance exception reads address `0x18` with `rax=0`, inside
the root addon at RVA `0x1e125`. The same crash reproduces using an independently
authored **83-byte** Identity model, before model inference or disposal.
Root-first loading passes as a diagnostic control; it is not the repair.

Upstream source explains the null table: the
[1.31 C++ initializer](https://github.com/microsoft/onnxruntime/blob/v1.31.1/include/onnxruntime/core/session/onnxruntime_cxx_api.h#L169)
requests API31; the
[1.30 runtime](https://github.com/microsoft/onnxruntime/blob/v1.30.0/onnxruntime/core/session/onnxruntime_c_api.cc#L4576)
prints the captured unsupported-version diagnostic and returns null.
[Environment construction](https://github.com/microsoft/onnxruntime/blob/v1.31.1/include/onnxruntime/core/session/onnxruntime_cxx_inline.h#L848)
uses its `CreateEnv` entry at x64 table offset0x18. Matching private ORT PDBs
were not packaged: source interpretation supplements exact module/register/
instruction evidence; the RVA is not claimed as a symbolized source line.
This attribution does not assign every earlier native crash to this cause.

The user selected parity with Transformers' exact dependency: **ORT1.30.0**.
The direct dependency is pinned exactly; a reference override keeps all Node
consumers on that package. The lockfile removes the nested native installation
and pairs the root with common1.30.0. The obsolete1.31.1 install-script entry is
removed. Browser/WASM dependencies retain their own upstream versions. Official
npm metadata and the
[latest stable Transformers release](https://github.com/huggingface/transformers.js/releases/tag/4.3.2)
still identify4.3.2;4.4.0-next.0 is a prerelease.

The setup probe now checks declared and installed versions, original resolved
entries, addon/package roots and common identity **before native import**. Two
fresh children then exercise both import orders. Each resolved consumer creates
a real CPU Identity session, verifies exact float32 output, disposes original
tensors and releases the session before natural exit. Nonempty stderr, native
status, truncation, timeout or unconfirmed cleanup fails verification. The
readiness receipt fingerprints this owner and records loadability separately
from bounded runtime lifecycle. Model quality and complete backend lifecycles
remain separate qualifications.

Observed results:

- Locked bootstrap completed in296.481s, exit0, all native rebuilds successful,
  zero audit vulnerabilities. Its single warning is npm's transitive
  `prebuild-install@7.1.3` deprecation; it is not suppressed.
- Fresh strengthened verification passed:37 required packages,33 parser routes,
  both native consumer orders, seven patches/25 targets/59 hunks. Its stderr
  contains two informational success lines and no warnings or errors.
- The **unchanged** minimized reproducer passes ten explicitly recorded fresh
  processes, alternating both import orders,225–245ms each; zero retries.
- The original public MiniLM adapter passes both orders in1,049/1,038ms,
  returning finite normalized384-dimensional output and original cleanup.
- Thirteen distinct focused cases pass. The original readiness test exposed
  premature static imports in two benchmark entry points; those actual imports
  now follow readiness admission. The strict original negative is retained,
  and readiness plus four benchmark controls pass after repair. The original
  failed invocations remain recorded.

The [durable receipt](windows-onnx-runtime-parity-2026-10-30.json) includes the
original command/failure/runtime hashes, minimized source, CDB exception,
all-thread stacks and module inventory, dependency verification and every fresh
case. `.tmp/` and `.testLogs` paths identify historical author-workspace files,
not artifacts promised by clean checkouts. The two small dumps total196,953B;
no full-memory dump or machine-wide debugger registration was used. No retry,
forced successful exit, backend disabling, Node change or model change repairs
this failure. Publication checks and broader model qualifications are tracked
separately.
