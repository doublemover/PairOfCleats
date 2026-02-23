import { sha1 } from '../../../src/shared/hash.js';
import { toPosix } from '../../../src/shared/files.js';

const compareSampleEntries = (left, right) => (
  left.score.localeCompare(right.score)
  || left.normalized.localeCompare(right.normalized)
);

const buildSampleEntry = ({ filePath, mode, seed, items = null }) => {
  const normalized = toPosix(filePath);
  return {
    filePath,
    items,
    normalized,
    score: sha1(`${seed}:${mode}:${normalized}`)
  };
};

export const selectDeterministicFileSample = ({ fileEntries, mode, maxFiles, seed }) => {
  if (!Array.isArray(fileEntries) || fileEntries.length <= maxFiles) return fileEntries;
  const scored = fileEntries.map(([filePath, items]) => buildSampleEntry({
    filePath,
    items,
    mode,
    seed
  }));
  scored.sort(compareSampleEntries);
  const selected = scored.slice(0, maxFiles);
  selected.sort((a, b) => a.normalized.localeCompare(b.normalized));
  return selected.map((entry) => [entry.filePath, entry.items]);
};

export const createDeterministicFileStreamSampler = ({
  mode,
  maxFiles,
  seed
}) => {
  const limit = Number.isFinite(Number(maxFiles)) ? Math.max(0, Math.floor(Number(maxFiles))) : 0;
  const selected = new Map();
  const seen = new Set();
  let worstKey = null;

  const recomputeWorstKey = () => {
    let worst = null;
    for (const candidate of selected.values()) {
      if (!worst || compareSampleEntries(worst, candidate) < 0) {
        worst = candidate;
      }
    }
    worstKey = worst?.normalized || null;
  };

  const considerFile = (filePath) => {
    const normalized = toPosix(filePath);
    if (!normalized || limit <= 0) {
      return { selected: false, normalized, evicted: null };
    }
    seen.add(normalized);
    const existing = selected.get(normalized);
    if (existing) {
      return { selected: true, normalized, evicted: null };
    }
    const candidate = buildSampleEntry({
      filePath: normalized,
      mode,
      seed
    });
    if (selected.size < limit) {
      selected.set(normalized, candidate);
      if (!worstKey) {
        worstKey = normalized;
      } else {
        const currentWorst = selected.get(worstKey);
        if (!currentWorst || compareSampleEntries(currentWorst, candidate) < 0) {
          worstKey = normalized;
        }
      }
      return { selected: true, normalized, evicted: null };
    }
    const worst = worstKey ? selected.get(worstKey) : null;
    if (!worst || compareSampleEntries(candidate, worst) >= 0) {
      return { selected: false, normalized, evicted: null };
    }
    const evicted = worst.normalized;
    selected.delete(evicted);
    selected.set(normalized, candidate);
    recomputeWorstKey();
    return { selected: true, normalized, evicted };
  };

  return {
    considerFile,
    getSeenCount: () => seen.size,
    getSelectedCount: () => selected.size
  };
};
