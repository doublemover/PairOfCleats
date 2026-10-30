# Regex benchmark identity and work

The regex microbenchmark compares the production `SafeRegex` wrapper under
explicit `re2js` and `re2` selection. It does not compare a wrapper with a direct
native constructor or claim an engine-kernel result. Each operation sets the
wrapper's `lastIndex` to zero, then calls `test` on the same input. Global patterns
therefore perform the same offset-zero operation rather than walking successive
matches and alternating with end-of-input failures.

All arms compile and verify their effective engine/flags before warmup or timing.
Optional native RE2 remains explicitly unavailable when its constructor cannot
load. Substitution cannot be published under the requested engine's name.
Repeated offset-zero matching witnesses compare first-match position and groups,
normalizing absent optional groups, before any timing begins. The report retains
their digest rather than another copy of matched input.

Report version 2 (`regex-wrapper-benchmark`) records requested/effective engines,
installed-package versions (unknown if unavailable), Node/V8/ABI/platform/arch,
requested/effective flags, input bytes, an exact UTF16-code-unit input hash and
operation policy. Samples are clamped
to measured iterations so the shared sampler cannot execute excess work when
configured with more buckets than operations. Actual callback count must equal
declared warmup plus measured work. Raw sample durations remain available; a
zero-duration rate is unknown instead of measured zero throughput. The shared
sampler's other callers keep their existing behavior.

The authored dispatch regression instruments the real SafeRegex selector and
real RE2JS backend. A named RegExp-backed optional-native adapter supplies
deterministic present/absent controls without claiming native speed. Both arms
must retain exact compile/operation counts; engine mismatch and matching-result
disagreement fail before sampling. Matching/nonmatching, global state reset,
sample-count admission and invalid count/flag controls remain explicit. Actual
native/runtime performance qualification is separate from these controls.
