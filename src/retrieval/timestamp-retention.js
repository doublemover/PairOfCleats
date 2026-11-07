const timestamp = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const height = node => node?.height || 0;
const refresh = node => { node.height = 1 + Math.max(height(node.left), height(node.right)); return node; };
const compare = (left, right) => right.ts - left.ts || left.rank - right.rank;
const rotateLeft = node => {
  const next = node.right;
  node.right = next.left; next.left = refresh(node);
  return refresh(next);
};
const rotateRight = node => {
  const next = node.left;
  node.left = next.right; next.right = refresh(node);
  return refresh(next);
};
const balance = node => {
  if (!node) return null;
  refresh(node);
  if (height(node.left) - height(node.right) > 1) {
    if (height(node.left.right) > height(node.left.left)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (height(node.right.left) > height(node.right.right)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
};
const insert = (root, node) => {
  if (!root) return node;
  if (compare(node, root) < 0) root.left = insert(root.left, node);
  else root.right = insert(root.right, node);
  return balance(root);
};
const takeFirst = root => {
  if (!root.left) {
    const rest = root.right;
    root.left = null; root.right = null; root.height = 1;
    return { first: root, rest };
  }
  const result = takeFirst(root.left);
  root.left = result.rest;
  return { first: result.first, rest: balance(root) };
};
const remove = (root, node) => {
  if (!root) return null;
  const order = compare(node, root);
  if (order < 0) root.left = remove(root.left, node);
  else if (order > 0) root.right = remove(root.right, node);
  else {
    const left = root.left, right = root.right;
    root.left = null; root.right = null; root.height = 1;
    if (!right) return left;
    const { first, rest } = takeFirst(right);
    first.left = left; first.right = rest;
    return balance(first);
  }
  return balance(root);
};

/**
 * Cache-local newest-write retention. A rank records the stable Map order at
 * the previous overflow, rather than treating reads as access-LRU touches.
 * Entry objects remain caller-owned, so an overflow reconciles timestamp
 * mutations in one linear pass before updating only the changed tree nodes.
 */
export class TimestampRetention {
  constructor() {
    this.nodes = new Map();
    this.root = null;
    this.nextRank = 0;
  }

  get size() { return this.nodes.size; }

  get(key) { return this.nodes.get(key)?.entry; }

  set(key, entry) {
    const existing = this.nodes.get(key);
    if (existing) { existing.entry = entry; return this; }
    const node = { key, entry, ts: timestamp(entry?.ts), rank: this.nextRank++, height: 1, left: null, right: null };
    this.nodes.set(key, node);
    this.root = insert(this.root, node);
    return this;
  }

  trim(maxEntries) {
    if (this.size <= maxEntries) return;
    const changed = [];
    for (const node of this.nodes.values()) {
      if (timestamp(node.entry?.ts) !== node.ts) changed.push(node);
    }
    // Remove with the old comparison keys before mutating any keys in the tree.
    for (const node of changed) this.root = remove(this.root, node);
    for (const node of changed) {
      node.ts = timestamp(node.entry?.ts);
      this.root = insert(this.root, node);
    }
    while (this.size > maxEntries) {
      let worst = this.root;
      while (worst.right) worst = worst.right;
      this.root = remove(this.root, worst);
      this.nodes.delete(worst.key);
    }
    // Stable sorting at an overflow establishes the baseline order for future
    // equal timestamps. Relabeling in-order preserves all tree comparisons.
    const stack = [];
    let node = this.root, rank = 0;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop(); node.rank = rank++; node = node.right;
    }
    this.nextRank = rank;
  }
}
