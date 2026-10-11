/**
 * Canonical persistent sequence concatenation. The split of a sequence of n
 * atoms is the largest power of two strictly below n. Union/Literal nodes are
 * atoms; Concat nodes contain exactly two canonical subsequences. This retains
 * sharing for aligned doubling without flattening an exponential operand list.
 * Rebalancing is budgeted; arbitrary insertion is not promised linear cost.
 */
export const createTypeIrSequence = ({ weight, bits, intern, budget }) => {
  const memo = new Map();
  const keyFor = (task) => {
    budget.allocate(160 + (task.op === 'split' ? bits(task.node) * 2 : 0));
    return task.op === 'join'
      ? `j:${task.left.id}:${task.right.id}`
      : `s:${task.node.id}:${task.at.toString(16)}`;
  };
  const join = (left, right) => {
    const stack = [];
    const enqueue = (task) => {
      const key = keyFor(task);
      if (!memo.has(key)) {
        budget.state();
        budget.allocate(256);
        stack.push({ ...task, key, phase: 0 });
      }
      return key;
    };
    const rootKey = enqueue({ op: 'join', left, right });
    while (stack.length) {
      budget.step();
      const frame = stack.at(-1);
      const finish = (result) => {
        memo.set(frame.key, result);
        stack.pop();
      };
      if (frame.phase === 0) {
        if (frame.op === 'join') {
          budget.allocate((Math.max(bits(frame.left), bits(frame.right)) + 1) * 2);
          const size = weight(frame.left) + weight(frame.right);
          const binary = size.toString(2);
          budget.step(binary.length);
          const power = (size & (size - 1n)) === 0n ? binary.length - 2 : binary.length - 1;
          const boundary = 1n << BigInt(power);
          if (weight(frame.left) === boundary) {
            finish(intern(frame.left, frame.right));
            continue;
          }
          frame.side = weight(frame.left) > boundary ? 'left' : 'right';
          frame.phase = 1;
          frame.dependency = enqueue(frame.side === 'left'
            ? { op: 'split', node: frame.left, at: boundary }
            : { op: 'split', node: frame.right, at: boundary - weight(frame.left) });
        } else {
          const [a, b] = frame.node.children;
          if (frame.at === weight(a)) {
            finish([a, b]);
            continue;
          }
          frame.side = frame.at < weight(a) ? 'left' : 'right';
          frame.phase = 1;
          frame.dependency = enqueue(frame.side === 'left'
            ? { op: 'split', node: a, at: frame.at }
            : { op: 'split', node: b, at: frame.at - weight(a) });
        }
        continue;
      }
      if (frame.phase === 1) {
        const [a, b] = memo.get(frame.dependency);
        frame.keep = frame.side === 'left' ? a : b;
        const outerLeft = frame.op === 'join' ? frame.left : frame.node.children[0];
        const outerRight = frame.op === 'join' ? frame.right : frame.node.children[1];
        frame.phase = 2;
        frame.dependency = enqueue(frame.side === 'left'
          ? { op: 'join', left: b, right: outerRight }
          : { op: 'join', left: outerLeft, right: a });
        continue;
      }
      const joined = memo.get(frame.dependency);
      const pair = frame.side === 'left' ? [frame.keep, joined] : [joined, frame.keep];
      finish(frame.op === 'join' ? intern(...pair) : pair);
    }
    return memo.get(rootKey);
  };
  return { join };
};
