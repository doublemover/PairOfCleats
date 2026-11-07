# Retained evidence page cleanup failures

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual retained-evidence page reader preserves the original operation and
independent paired-reader cleanup failures through the existing storage failure
compositor. Presence is explicit: thrown null, undefined, false, zero and empty
strings are failures. Frozen or readonly original errors are not mutated through
a cleanupError field. Original resource observations are captured before cleanup
can inspect or replace diagnostics. A failed close withholds the page and cursor.

Nested original contained-file sessions remain their exact existing capabilities.
The page layer adds no group release, retries or deletion authority. Authored
controls use real checksummed JSONL/offset pieces above the snapshot threshold,
actual positioned readers and original FileHandle read/close methods. They retain
both causes, independent close attempts, exact explicit recovery without page/read
replay, and ordinary content/cursor positives. None has executed.

This repairs failure composition only. Existing page bounds, canonical validation,
cursor scope and publication checks are unchanged. Abandoned pages, independently
pending arbitrary selection callbacks, full outer service/continuation ownership,
native close retry safety and platform/performance acceptance remain separate.

The #1714 source repair adds a bounded whole-enumeration session using these same
per-descriptor owners. Independent pages still close before returning. Enumerated
terminal pages close before yielding; nonterminal pages retain a bounded pair
until advance, return or abort. CLI output uses `consumeJsonRows` so output and
independent iterator cleanup failures are both retained. New controls exercise
the actual larger-than-snapshot readers and original failed-close capability,
without replaying reads or output during explicit recovery. They remain unrun.
