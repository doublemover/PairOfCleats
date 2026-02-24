# Stage1 Backpressure Controller Spec

## Purpose
Specify byte-budgeted dispatch throttling and hysteresis for stable Stage1 memory behavior.

## Signals
- `bufferedBytesGlobal`
- `bufferedBytesByWindow[windowId]`
- `commitLag = maxSeenSeq - nextCommitSeq`
- `heapUsedBytes`
- `envelopeCount`

## Config
- `globalBufferedBytesSoft`
- `globalBufferedBytesHard`
- `windowBufferedBytesSoft`
- `windowBufferedBytesHard`
- `commitLagSoft`
- `commitLagHard`
- `resumeHysteresisRatio`

## Policy
1. Dispatch pauses when any hard threshold is breached.
2. Dispatch slows (reduced dispatch quantum) when soft threshold is breached.
3. Resume only when all throttling signals fall below hysteresis release limits.
4. Commit lane is never throttled by this controller.

## Hysteresis
If paused at threshold `T`, release threshold is `T * resumeHysteresisRatio` where ratio `< 1`.

## Window Awareness
1. Over-budget `W1` throttles only compute prefetch first.
2. Over-budget `W0` may block new dispatch while commit continues draining.
3. Controller MUST preserve two-window contract.

## Metrics
Controller emits:
- `backpressure.state` (`normal`, `soft`, `hard`)
- `backpressure.pause_reason`
- `backpressure.pause_ms`
- `backpressure.resume_count`

## Acceptance
Compliant implementation demonstrates:
1. Memory remains bounded by configured budgets in stress tests.
2. Hysteresis avoids rapid pause/resume flapping.
3. Commit lag pressure feeds deterministic throttle decisions.
