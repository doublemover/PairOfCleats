# Spec: VFS CDC segmentation (draft)

Status: Draft (Milestone A). Optional segmentation strategy.

Goal: provide content-defined segments for large files so segment boundaries and `segmentUid` are stable across small edits, even when semantic segmentation is unavailable.

Non-goals:
- Replace language-aware segmentation (markdown, vue, jsx, etc.).
- Change chunk semantics or `docHash` computation.

---

## 1) When to apply

CDC segmentation is only applied when:
- No language-specific segmentation exists for the container.
- File size exceeds a configurable threshold.

Configuration (indexing):

```json
{
  "indexing": {
    "segments": {
      "cdc": {
        "enabled": false,
        "minFileBytes": 262144,
        "minBytes": 4096,
        "avgBytes": 16384,
        "maxBytes": 65536,
        "windowBytes": 64,
        "maskBits": 13
      }
    }
  }
}
```

---

## 2) Algorithm (normative)

Use a rolling hash (Rabin or gear-based) to find boundaries:

Parameters:
- `minBytes`: minimum segment size
- `avgBytes`: target average size
- `maxBytes`: maximum segment size
- `windowBytes`: rolling window size
- `maskBits`: number of low bits used for boundary detection

Pseudo-logic:

1. Initialize rolling hash at `windowBytes`.
2. Advance byte-by-byte, updating the hash.
3. Cut when:
   - `size >= minBytes` and `(hash & ((1 << maskBits) - 1)) == 0`, OR
   - `size >= maxBytes`.
4. Emit final segment for the remainder.

---

## 3) Segment metadata

Each segment MUST include:

```ts
type CdcSegmentMeta = {
  algorithm: "cdc";
  cdc: {
    minBytes: number;
    avgBytes: number;
    maxBytes: number;
    windowBytes: number;
    maskBits: number;
  };
};
```

`segmentUid` MUST be derived via the identity contract using `segmentType = "cdc"` and the normalized segment text.

---

## 4) Invariants

- Segments cover the entire file with no gaps or overlaps.
- `segmentStart` and `segmentEnd` are monotonic.
- Segment sizes are within `[minBytes, maxBytes]` except the final segment.

---

## 5) Related specs

- `docs/specs/vfs-segment-hash-cache.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
