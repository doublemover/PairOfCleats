const DEFAULT_SLACK = 0;
const DEFAULT_HEAP_THRESHOLD = 2;
const DEFAULT_MIN_HEAP_SIZE = 32;

const normalizeScore = (value) => {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
};

const normalizeIdValue = (value) => {
  const num = Number(value);
  if (Number.isFinite(num)) return { type: 'number', value: num };
  return { type: 'string', value: value == null ? '' : String(value) };
};

const compareNormalizedIds = (a, b) => {
  const left = normalizeIdValue(a);
  const right = normalizeIdValue(b);
  if (left.type !== right.type) return left.type === 'number' ? -1 : 1;
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  return 0;
};

export const compareTopKEntries = (a, b) => {
  const scoreA = Number.isFinite(a?.score) ? a.score : -Infinity;
  const scoreB = Number.isFinite(b?.score) ? b.score : -Infinity;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const idCompare = compareNormalizedIds(a?.id, b?.id);
  if (idCompare) return idCompare;
  const rankA = Number.isFinite(a?.sourceRank) ? a.sourceRank : 0;
  const rankB = Number.isFinite(b?.sourceRank) ? b.sourceRank : 0;
  return rankA - rankB;
};

const isBetter = (score, id, rank, other) => {
  if (!other) return true;
  const scoreOther = Number.isFinite(other.score) ? other.score : -Infinity;
  if (score !== scoreOther) return score > scoreOther;
  const idCompare = compareNormalizedIds(id, other.id);
  if (idCompare) return idCompare < 0;
  const rankOther = Number.isFinite(other.sourceRank) ? other.sourceRank : 0;
  return rank < rankOther;
};

const worseThan = (a, b) => {
  if (!a || !b) return false;
  if (a.score !== b.score) return a.score < b.score;
  const idCompare = compareNormalizedIds(a.id, b.id);
  if (idCompare) return idCompare > 0;
  return (a.sourceRank || 0) > (b.sourceRank || 0);
};

const heapSwap = (heap, i, j) => {
  const temp = heap[i];
  heap[i] = heap[j];
  heap[j] = temp;
};

const heapBubbleUp = (heap, index) => {
  let i = index;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!worseThan(heap[i], heap[parent])) break;
    heapSwap(heap, i, parent);
    i = parent;
  }
};

const heapBubbleDown = (heap, index) => {
  let i = index;
  while (true) {
    const left = (i << 1) + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && worseThan(heap[left], heap[smallest])) smallest = left;
    if (right < heap.length && worseThan(heap[right], heap[smallest])) smallest = right;
    if (smallest === i) break;
    heapSwap(heap, i, smallest);
    i = smallest;
  }
};

let lastTopKStats = null;

export const getLastTopKStats = () => lastTopKStats;

const recordTopKStats = (stats) => {
  if (!stats) return;
  lastTopKStats = { ...stats };
};

export const createTopKReducer = ({
  k,
  slack = DEFAULT_SLACK,
  score,
  id,
  sourceRank,
  buildPayload,
  sorted = false,
  maxMs = null,
  stats = null
} = {}) => {
  const limit = Math.max(0, Math.floor(Number(k) || 0) + Math.max(0, Math.floor(Number(slack) || 0)));
  const heap = [];
  let seen = 0;
  let cutoffs = 0;
  const started = maxMs ? Date.now() : 0;
  const statsRef = stats || {
    seen: 0,
    kept: 0,
    cutoffs: 0,
    maxSize: 0,
    usedHeap: true,
    usedSort: false
  };
  const useScore = typeof score === 'function' ? score : ((item) => item?.score ?? item?.sim ?? 0);
  const useId = typeof id === 'function' ? id : ((item) => item?.idx ?? item?.id ?? null);
  const useRank = typeof sourceRank === 'function' ? sourceRank : ((item, index) => {
    const rankValue = item?.sourceRank;
    return Number.isFinite(rankValue) ? rankValue : index;
  });
  const payloadBuilder = typeof buildPayload === 'function'
    ? buildPayload
    : ((entry) => (
      entry?.payload
      ?? entry?.item
      ?? { idx: entry.id, score: entry.score }
    ));

  const updateStats = () => {
    statsRef.seen = seen;
    statsRef.kept = heap.length;
    statsRef.cutoffs = cutoffs;
    statsRef.maxSize = Math.max(statsRef.maxSize || 0, heap.length);
    statsRef.usedHeap = true;
    statsRef.usedSort = false;
  };

  const makeEntry = (scoreValue, idValue, rankValue, payload, item) => ({
    score: scoreValue,
    id: idValue,
    sourceRank: rankValue,
    payload,
    item
  });

  const shouldStopEarly = (scoreValue, idValue, rankValue) => {
    if (!sorted || heap.length < limit) return false;
    if (maxMs && started) {
      const elapsed = Date.now() - started;
      if (elapsed < maxMs) return false;
    }
    const worst = heap[0];
    if (isBetter(scoreValue, idValue, rankValue, worst)) return false;
    return true;
  };

  const pushRaw = (scoreValue, idValue, rankValue, payload, item) => {
    if (!limit) return false;
    const normalized = normalizeScore(scoreValue);
    seen += 1;
    if (normalized == null) return false;
    const rankVal = Number.isFinite(rankValue) ? rankValue : seen - 1;
    if (heap.length < limit) {
      heap.push(makeEntry(normalized, idValue, rankVal, payload, item));
      heapBubbleUp(heap, heap.length - 1);
      updateStats();
      return false;
    }
    if (!isBetter(normalized, idValue, rankVal, heap[0])) {
      if (shouldStopEarly(normalized, idValue, rankVal)) {
        cutoffs += 1;
        updateStats();
        return true;
      }
      updateStats();
      return false;
    }
    heap[0] = makeEntry(normalized, idValue, rankVal, payload, item);
    heapBubbleDown(heap, 0);
    updateStats();
    return false;
  };

  const push = (item) => {
    const scoreValue = useScore(item, seen);
    const idValue = useId(item, seen);
    const rankValue = useRank(item, seen);
    const payload = payloadBuilder({ item, score: scoreValue, id: idValue, sourceRank: rankValue });
    return pushRaw(scoreValue, idValue, rankValue, payload, item);
  };

  const finish = ({ limit: finalLimit = k } = {}) => {
    statsRef.seen = seen;
    statsRef.kept = heap.length;
    statsRef.cutoffs = cutoffs;
    statsRef.maxSize = Math.max(statsRef.maxSize || 0, heap.length);
    statsRef.usedHeap = true;
    statsRef.usedSort = false;
    const sortedHeap = heap.slice().sort(compareTopKEntries);
    const capped = Number.isFinite(Number(finalLimit)) ? Math.max(0, Math.floor(Number(finalLimit))) : k;
    const sliced = capped && sortedHeap.length > capped
      ? sortedHeap.slice(0, capped)
      : sortedHeap;
    const output = sliced.map((entry) => payloadBuilder(entry));
    recordTopKStats(statsRef);
    return output;
  };

  return {
    push,
    pushRaw,
    finish,
    stats: statsRef,
    limit,
    started
  };
};

export const selectTopK = (items, {
  k,
  slack = DEFAULT_SLACK,
  score,
  id,
  sourceRank,
  sorted = false,
  maxMs = null,
  stats = null,
  heapThreshold = DEFAULT_HEAP_THRESHOLD,
  minHeapSize = DEFAULT_MIN_HEAP_SIZE
} = {}) => {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(0, Math.floor(Number(k) || 0));
  if (!limit || list.length === 0) {
    const empty = [];
    if (stats) {
      stats.seen = 0;
      stats.kept = 0;
      stats.cutoffs = 0;
      stats.maxSize = 0;
      stats.usedHeap = false;
      stats.usedSort = true;
    }
    recordTopKStats(stats || {
      seen: 0,
      kept: 0,
      cutoffs: 0,
      maxSize: 0,
      usedHeap: false,
      usedSort: true
    });
    return empty;
  }
  if (list.length <= limit) {
    const baseline = list.slice().sort((a, b) => {
      const entryA = { score: score ? score(a) : (a?.score ?? a?.sim ?? 0), id: id ? id(a) : (a?.idx ?? a?.id) };
      const entryB = { score: score ? score(b) : (b?.score ?? b?.sim ?? 0), id: id ? id(b) : (b?.idx ?? b?.id) };
      entryA.sourceRank = sourceRank ? sourceRank(a) : (a?.sourceRank ?? 0);
      entryB.sourceRank = sourceRank ? sourceRank(b) : (b?.sourceRank ?? 0);
      return compareTopKEntries(entryA, entryB);
    });
    if (stats) {
      stats.seen = list.length;
      stats.kept = baseline.length;
      stats.cutoffs = 0;
      stats.maxSize = baseline.length;
      stats.usedHeap = false;
      stats.usedSort = true;
    }
    recordTopKStats(stats || {
      seen: list.length,
      kept: baseline.length,
      cutoffs: 0,
      maxSize: baseline.length,
      usedHeap: false,
      usedSort: true
    });
    return baseline;
  }

  const shouldUseHeap = list.length >= Math.max(minHeapSize, limit * heapThreshold);
  if (!shouldUseHeap) {
    const baseline = list.slice().sort((a, b) => {
      const entryA = { score: score ? score(a) : (a?.score ?? a?.sim ?? 0), id: id ? id(a) : (a?.idx ?? a?.id) };
      const entryB = { score: score ? score(b) : (b?.score ?? b?.sim ?? 0), id: id ? id(b) : (b?.idx ?? b?.id) };
      entryA.sourceRank = sourceRank ? sourceRank(a) : (a?.sourceRank ?? 0);
      entryB.sourceRank = sourceRank ? sourceRank(b) : (b?.sourceRank ?? 0);
      return compareTopKEntries(entryA, entryB);
    });
    const sliced = baseline.slice(0, limit);
    if (stats) {
      stats.seen = list.length;
      stats.kept = sliced.length;
      stats.cutoffs = 0;
      stats.maxSize = sliced.length;
      stats.usedHeap = false;
      stats.usedSort = true;
    }
    recordTopKStats(stats || {
      seen: list.length,
      kept: sliced.length,
      cutoffs: 0,
      maxSize: sliced.length,
      usedHeap: false,
      usedSort: true
    });
    return sliced;
  }

  const reducer = createTopKReducer({
    k: limit,
    slack,
    score,
    id,
    sourceRank,
    sorted,
    maxMs,
    stats
  });
  for (let i = 0; i < list.length; i += 1) {
    const stop = reducer.push(list[i]);
    if (stop) break;
  }
  const result = reducer.finish({ limit });
  if (stats) {
    stats.usedHeap = true;
    stats.usedSort = false;
  }
  return result;
};
