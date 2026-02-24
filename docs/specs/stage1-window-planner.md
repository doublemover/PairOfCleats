# Stage1 Window Planner Spec

## Purpose
Define deterministic contiguous `seq` windows used by Stage1 compute and commit lanes.

## Inputs
- Ordered entries with fields: `seq`, `estimatedCost`, `estimatedBytes`, `estimatedLines`, optional `languageKey`.
- Runtime planner config:
  - `targetWindowCost`
  - `maxWindowCost`
  - `maxWindowBytes`
  - `maxInFlightSeqSpan`
  - `minWindowEntries`
  - `maxWindowEntries`

## Output
List of windows with:
- `windowId`
- `startSeq`
- `endSeq`
- `predictedCost`
- `predictedBytes`
- `entryCount`
- `seedHash`

Each window MUST satisfy contiguous `seq` range `[startSeq, endSeq]` with no holes.

## Deterministic Construction Rules
1. Iterate entries in ascending `seq`.
2. Grow current window until next entry would violate hard caps.
3. Flush current window and start next at violating entry.
4. Tie-breaks are stable and depend only on deterministic input fields.
5. `seedHash` is derived from runtime planner config and discovery hash.

## Hard Caps
Window split MUST occur when any condition becomes true:
1. `predictedCost > maxWindowCost`
2. `predictedBytes > maxWindowBytes`
3. `(endSeq - startSeq + 1) > maxInFlightSeqSpan`
4. `entryCount > maxWindowEntries`

## Adaptive Resize Policy
Adaptive resizing is deterministic on telemetry snapshots:
- `commitLag`
- `bufferedBytes`
- `computeUtilization`
- `retryRate`

Policy:
1. Shrink next windows when lag or memory pressure is high.
2. Grow next windows when utilization is low and lag is low.
3. Clamp outputs to hard caps and minimums.
4. Apply changes only at window boundary.

## Active Window Contract
1. At most two windows active simultaneously.
2. `W0` is commit-cursor window.
3. `W1` may compute but cannot advance commit cursor directly.
4. Dispatch outside active windows is forbidden.

## Acceptance
Compliant implementation proves:
1. Same inputs produce identical window boundaries.
2. No discontiguous window ranges.
3. Adaptive behavior remains deterministic with fixed snapshots.
