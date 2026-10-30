# Bounded language cost observations

Run `node tests/perf/qualification/language-costs.js <fresh-absolute-output>`
with the prepared Node26 runtime. This manual companion is outside ordinary
test discovery. It executes nine serial fresh-process capsules: three
repetitions of each scenario, reversing scenario order in the middle repetition.
Each original subprocess has a30-second deadline, zero retries, bounded output
and process-tree cleanup through the existing qualification owner. Missing
native prerequisites, incomplete semantic results or failed resource sampling
are failures. The campaign refuses a source change during execution.

- `python-inline`:64,256 and1,024 independently named ASCII or Unicode imports in
  inline and multiline suites, with colon/string negatives. Every timed result must contain
  the exact independently authored import list.
- `python-lines`:8Ki,64Ki and256Ki target source sizes, one long line versus
  many short lines, with ASCII/Unicode and LF/CRLF/CR arms. Actual UTF8 bytes
  are recorded for each shape. Every physical
  line is touched at three independently known UTF8 boundaries. Exact original
  UTF16 offsets and line starts are checked. A separate original
  `Uint32Array.from` observation counts actual byte/unit checkpoint payloads
  while the resolver remains alive; the ASCII fast path must allocate none.
  JS line-index arrays, maps and objects are
  outside that typed-array byte count.
- `yaml`:eight documents with128 total headings. Canonical, native query,
  native walk and actual warm-cache query/walk routes retain exact names,
  ranges, document owners and complete source reconstruction. Native projection
  visits, actual native query executions and16 actual cache hits per warm cohort
  are asserted; traversal cannot qualify query execution.32 distinct sources
  avoid the canonical parser's single-entry text cache during measured work.
  Canonical token/CST/node counters and source-owned logical cache charges remain
  separate from output bytes and process memory. Warm results retain all native
  metadata except the canonical owner's per-invocation timing metrics. Expected
  names and document/section boundaries come from authored source separators.
  Existing parser deadlines remain unchanged.

Each cohort retains16 raw clean wall/thread-CPU samples, before/after process
memory observations, source/output hashes and serialized output bytes. Boundary
memory samples do not establish a peak or measure the resolver closure's entire
retained heap. Output bytes are logical JSON payload bytes, not heap allocation.

An independent16-operation pass uses the original Node inspector session and
V8 heap sampling at32KiB, including objects collected by both minor and major
GC. It preserves bounded raw sample sizes and node/call-frame addresses in
separate hashed files, then disconnects the original session. This is
[Poisson heap sampling](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-startSampling),
not exact allocation counting, native allocation tracking or continuous retained
memory measurement. Profiling work is separate from clean CPU/latency samples.
These observations qualify the supplied current-source workloads; they do not
claim a historical speedup, whole-index performance, or broader model quality.

Receipts under an author's `.testLogs` or `.tmp` are historical workspace
observations. Publish their source identity, hashes and relevant raw samples in
a durable audit receipt before citing a completed qualification in a clean
checkout.
