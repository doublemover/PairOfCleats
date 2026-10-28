const height = node => node?.height || 0;
const count = node => node?.count || 0;
const bytes = node => node?.bytes || 0;
const keyBytes = key => 256 + key.length * 2;
const checkpoints = new WeakSet();
const itemBytes = item => {
  if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['ref', 'depth', 'traverse', 'stack'].includes(key))
    || !item.ref || Object.keys(item.ref).some(key => !['partitionId', 'localId'].includes(key))
    || typeof item.ref.partitionId !== 'string' || !/^(sy1|sa1):[a-f0-9]{64}$/u.test(item.ref.partitionId)
    || !Number.isSafeInteger(item.ref.localId) || item.ref.localId < 0
    || !Number.isSafeInteger(item.depth) || item.depth < 0 || item.depth > 64 || typeof item.traverse !== 'boolean'
    || item.stack !== undefined && (!Array.isArray(item.stack) || item.stack.length > 16 || item.stack.some(value => typeof value !== 'string'))) {
    throw new TypeError('Trace state requires a compact qualified ref/context item.');
  }
  return 384 + item.ref.partitionId.length * 2 + (item.stack || []).reduce((total, value) => total + 16 + value.length * 2, 0);
};

// Persistent AVL nodes share immutable ancestors/subtrees across cursor forks.
// Byte totals conservatively charge each snapshot's logical tree, even when
// physical nodes/string storage are shared. They do not claim V8/RSS accounting.
const treeNode = (key, left, right, metrics) => {
  metrics.visitedNodeAllocations++;
  return Object.freeze({ key, left, right, height: 1 + Math.max(height(left), height(right)),
    count: 1 + count(left) + count(right), bytes: keyBytes(key) + bytes(left) + bytes(right) });
};
const rotateLeft = (node, metrics) => treeNode(node.right.key,
  treeNode(node.key, node.left, node.right.left, metrics), node.right.right, metrics);
const rotateRight = (node, metrics) => treeNode(node.left.key, node.left.left,
  treeNode(node.key, node.left.right, node.right, metrics), metrics);
const balance = (node, metrics) => {
  const difference = height(node.left) - height(node.right);
  if (difference > 1) {
    if (height(node.left.left) < height(node.left.right)) node = treeNode(node.key, rotateLeft(node.left, metrics), node.right, metrics);
    return rotateRight(node, metrics);
  }
  if (difference < -1) {
    if (height(node.right.right) < height(node.right.left)) node = treeNode(node.key, node.left, rotateRight(node.right, metrics), metrics);
    return rotateLeft(node, metrics);
  }
  return node;
};
const insert = (root, key, metrics) => !root ? treeNode(key, null, null, metrics)
  : balance(key < root.key ? treeNode(root.key, insert(root.left, key, metrics), root.right, metrics)
    : treeNode(root.key, root.left, insert(root.right, key, metrics), metrics), metrics);
const contains = (root, key, metrics) => {
  while (root) {
    metrics.visitedComparisons++;
    if (root.key === key) return true;
    root = key < root.key ? root.left : root.right;
  }
  return false;
};
const queueNode = (value, next, metrics) => {
  metrics.queueNodeAllocations++;
  return Object.freeze({ value, next, count: 1 + count(next), bytes: 128 + value.bytes + bytes(next) });
};

/** One mutable page facade over immutable state; forks share only frozen roots.
 * New refs/contexts are copied once on admission, never once per old page. */
export const createTraceTraversalState = ({ checkpoint = null, maxBytes = 8 * 1024 * 1024, metrics = {} } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 64 * 1024 * 1024) throw new TypeError('Invalid trace state byte allowance.');
  if (checkpoint !== null && !checkpoints.has(checkpoint)) throw new TypeError('Trace checkpoint has no immutable state owner.');
  let seen = checkpoint?.seen || null, front = checkpoint?.front || null, back = checkpoint?.back || null;
  const stats = { visitedNodeAllocations: 0, visitedComparisons: 0, queueNodeAllocations: 0, reversedFrontierEntries: 0,
    admittedEntries: 0, copiedItemBytes: 0, copiedHistoryEntries: 0, snapshots: 0, peakStateBytes: 0 };
  const currentBytes = () => 256 + bytes(seen) + bytes(front) + bytes(back);
  const publish = () => { stats.peakStateBytes = Math.max(stats.peakStateBytes, currentBytes()); Object.assign(metrics, stats); };
  if (currentBytes() > maxBytes) throw new TypeError('Trace checkpoint exceeds its state byte allowance.');
  const normalize = () => {
    if (front) return;
    let reversed = null;
    for (let node = back; node; node = node.next) { reversed = queueNode(node.value, reversed, stats); stats.reversedFrontierEntries++; }
    front = reversed; back = null; publish();
  };
  const owner = {
    enqueue(item, identity) {
      if (typeof identity !== 'string') throw new TypeError('Trace visit identity must be canonical text.');
      if (contains(seen, identity, stats)) { publish(); return 'existing'; }
      const valueBytes = Math.max(itemBytes(item), 256 + identity.length * 2);
      if (count(seen) >= 16384 || currentBytes() + keyBytes(identity) + 128 + valueBytes > maxBytes) { publish(); return 'budget'; }
      const copied = structuredClone(item);
      if (copied.ref) Object.freeze(copied.ref);
      if (copied.stack) Object.freeze(copied.stack);
      const value = Object.freeze({ item: Object.freeze(copied), bytes: valueBytes });
      const nextSeen = insert(seen, identity, stats), nextBack = queueNode(value, back, stats);
      seen = nextSeen; back = nextBack;
      stats.admittedEntries++; stats.copiedItemBytes += valueBytes; publish(); return 'admitted';
    },
    reset(item, identity) {
      const previous = { seen, front, back };
      seen = null; front = null; back = null;
      try {
        if (owner.enqueue(item, identity) !== 'admitted') throw Object.assign(
          new Error('Trace seed cannot fit the state byte allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
      } catch (error) {
        ({ seen, front, back } = previous); publish(); throw error;
      }
    },
    peek() { normalize(); return front?.value.item || null; },
    shift() { normalize(); if (front) front = front.next; publish(); },
    snapshot() {
      stats.snapshots++; publish();
      const checkpoint = Object.freeze({ seen, front, back }); checkpoints.add(checkpoint); return checkpoint;
    },
    get size() { return count(front) + count(back); },
    get seenCount() { return count(seen); },
    get logicalBytes() { return currentBytes(); },
    stats: () => Object.freeze({ ...stats, frontierEntries: count(front) + count(back), visitedEntries: count(seen), logicalBytes: currentBytes() })
  };
  publish(); return Object.freeze(owner);
};

const budgets = new WeakSet();
/** Shared retention only, across services; active page state has its own bound.
 * Old cursors remain replayable until explicit TTL/count/byte eviction. */
export const createTraceContinuationBudget = ({ maxBytes = 64 * 1024 * 1024 } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 256 * 1024 * 1024) throw new TypeError('Invalid trace retention budget.');
  const retained = new Map(); let used = 0, peak = 0, evictions = 0;
  const remove = token => {
    const entry = retained.get(token); if (!entry) return;
    retained.delete(token); used -= entry.bytes; entry.retire();
  };
  const budget = Object.freeze({
    retain(bytes, expires, retire) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes || !Number.isFinite(expires) || typeof retire !== 'function') {
        throw Object.assign(new Error('Trace continuation cannot fit the aggregate retention allowance.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
      }
      budget.sweep();
      while (used + bytes > maxBytes) { evictions++; remove(retained.keys().next().value); }
      const token = Symbol('trace continuation');
      retained.set(token, { bytes, expires, retire }); used += bytes; peak = Math.max(peak, used);
      return Object.freeze({ release: () => remove(token) });
    },
    sweep(now = Date.now()) { for (const [token, entry] of retained) if (entry.expires <= now) { evictions++; remove(token); } },
    stats: () => Object.freeze({ accounting: 'conservative-logical-snapshot-bytes; shared state may be charged repeatedly',
      maxBytes, retainedBytes: used, peakRetainedBytes: peak, retainedCursors: retained.size, evictions })
  });
  budgets.add(budget); return budget;
};
export const isTraceContinuationBudget = budget => budgets.has(budget);
