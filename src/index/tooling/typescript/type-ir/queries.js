import { createTypeIrBudget, invalidTypeIr, typeIrPostorder } from './budget.js';

/** Exact truncated cardinality and at most two distinct concrete witnesses.
 * Nonempty concatenation is singleton iff every factor is singleton: varying
 * one factor while fixing all others preserves inequality by cancellation.
 * No cardinalities are added or multiplied across overlapping languages.
 */
export const classifyTypeIr = (arena, root, options = {}) => {
  arena.assertNode(root);
  const budget = createTypeIrBudget(options, 'type-ir.classify');
  const maxWitnessBytes = options.maxWitnessBytes;
  if (maxWitnessBytes !== undefined && (!Number.isSafeInteger(maxWitnessBytes) || maxWitnessBytes < 0)) {
    throw invalidTypeIr('invalid maxWitnessBytes');
  }
  const admitWitnessBytes = bytes => {
    budget.check();
    if (maxWitnessBytes !== undefined && bytes > maxWitnessBytes) {
      budget.fail('maxWitnessBytes_exceeded', { requested: bytes, maxWitnessBytes });
    }
  };
  const concatenatedBytes = (parts, sizes) => {
    let total = 0;
    let previous = -1;
    for (let index = 0; index < parts.length; index += 1) {
      budget.step();
      const part = parts[index];
      total += sizes[index];
      if (!part.length) continue;
      const first = part.charCodeAt(0);
      // UTF-8 encodes two formerly lone surrogate halves as one scalar: 6 -> 4.
      if (previous >= 0xd800 && previous <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) total -= 2;
      previous = part.charCodeAt(part.length - 1);
    }
    return total;
  };
  const witnesses = new Map();
  const byteLengths = new Map();
  for (const node of typeIrPostorder(root, budget)) {
    budget.step();
    budget.allocate(144);
    if (node.kind === 'Literal') {
      budget.step(node.value.length);
      const bytes = Buffer.byteLength(node.value, 'utf8');
      admitWitnessBytes(bytes);
      witnesses.set(node, [node.value]);
      byteLengths.set(node, [bytes]);
      continue;
    }
    if (node.kind === 'Union') {
      const found = [];
      const sizes = [];
      for (const child of node.children) {
        budget.step();
        const values = witnesses.get(child);
        for (let index = 0; index < values.length; index += 1) {
          const value = values[index];
          budget.step(found.length && found[0].length === value.length ? value.length + 1 : 1);
          if (found.length === 0 || found[0] !== value) {
            const bytes = byteLengths.get(child)[index];
            admitWitnessBytes(bytes + (sizes[0] || 0));
            found.push(value);
            sizes.push(bytes);
          }
          if (found.length === 2) break;
        }
        if (found.length === 2) break;
      }
      witnesses.set(node, found);
      byteLengths.set(node, sizes);
      continue;
    }
    const parts = [];
    const partBytes = [];
    let length = 0;
    let alternative = -1;
    let empty = false;
    budget.allocate(node.children.length * 24);
    for (let index = 0; index < node.children.length; index += 1) {
      budget.step();
      const child = witnesses.get(node.children[index]);
      if (child.length === 0) { empty = true; break; }
      parts.push(child[0]);
      partBytes.push(byteLengths.get(node.children[index])[0]);
      length += child[0].length;
      if (child.length > 1) alternative = index;
    }
    if (empty) { witnesses.set(node, []); byteLengths.set(node, []); continue; }
    const firstBytes = concatenatedBytes(parts, partBytes);
    admitWitnessBytes(firstBytes);
    budget.stringLength(length);
    budget.allocate(length * 2);
    budget.step(length);
    const first = parts.join('');
    if (alternative === -1) {
      witnesses.set(node, [first]); byteLengths.set(node, [firstBytes]); continue;
    }
    const secondPart = witnesses.get(node.children[alternative])[1];
    const secondLength = length - parts[alternative].length + secondPart.length;
    parts[alternative] = secondPart;
    partBytes[alternative] = byteLengths.get(node.children[alternative])[1];
    const secondBytes = concatenatedBytes(parts, partBytes);
    admitWitnessBytes(firstBytes + secondBytes);
    budget.stringLength(secondLength);
    budget.allocate(secondLength * 2);
    budget.step(secondLength);
    witnesses.set(node, [first, parts.join('')]);
    byteLengths.set(node, [firstBytes, secondBytes]);
  }
  budget.check();
  const values = witnesses.get(root);
  return Object.freeze({ cardinality: ['zero', 'one', 'many'][values.length],
    witnesses: Object.freeze(values.slice()), complete: true });
};

/** Exact membership in a finite-string DAG using reachable input offsets.
 * The memo table is keyed by (node, start offset); no product strings are built.
 * Ambiguous segmentations and overlapping unions retain every reachable end.
 */
export const containsTypeIr = (arena, root, text, options = {}) => {
  arena.assertNode(root);
  if (typeof text !== 'string') throw invalidTypeIr('membership input must be a string');
  const budget = createTypeIrBudget(options, 'type-ir.contains');
  budget.input(text);
  const memo = new Map();
  const stack = [];
  const lookup = (node, offset) => memo.get(node)?.get(offset);
  const append = (set, offset) => {
    budget.step();
    if (!set.has(offset)) { budget.allocate(32); set.add(offset); }
  };
  const push = (node, start) => {
    budget.state();
    budget.allocate(320);
    stack.push({ node, start, index: 0, result: new Set(),
      frontier: new Set([start]), iterator: null, position: null, next: null });
  };
  const finish = (frame, ends) => {
    let starts = memo.get(frame.node);
    if (!starts) { starts = new Map(); memo.set(frame.node, starts); }
    starts.set(frame.start, ends);
    stack.pop();
  };
  push(root, 0);
  while (stack.length) {
    budget.step();
    const frame = stack.at(-1);
    const { node } = frame;
    if (node.kind === 'Literal') {
      if (node.value.length <= text.length - frame.start) {
        budget.step(node.value.length);
        if (text.startsWith(node.value, frame.start)) append(frame.result, frame.start + node.value.length);
      }
      finish(frame, frame.result);
      continue;
    }
    if (node.kind === 'Union') {
      if (frame.index === node.children.length) { finish(frame, frame.result); continue; }
      const child = node.children[frame.index];
      const ends = lookup(child, frame.start);
      if (!ends) { push(child, frame.start); continue; }
      for (const end of ends) append(frame.result, end);
      frame.index += 1;
      continue;
    }
    if (frame.index === node.children.length || frame.frontier.size === 0) {
      finish(frame, frame.frontier);
      continue;
    }
    if (!frame.iterator) {
      budget.allocate(96);
      frame.iterator = frame.frontier.values();
      frame.position = frame.iterator.next();
      frame.next = new Set();
    }
    if (frame.position.done) {
      frame.frontier = frame.next;
      frame.iterator = null;
      frame.index += 1;
      continue;
    }
    const child = node.children[frame.index];
    const ends = lookup(child, frame.position.value);
    if (!ends) { push(child, frame.position.value); continue; }
    for (const end of ends) append(frame.next, end);
    frame.position = frame.iterator.next();
  }
  budget.check();
  return lookup(root, 0).has(text.length);
};
