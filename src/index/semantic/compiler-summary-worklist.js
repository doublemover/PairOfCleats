/** Scheduling only: both modes execute the same transfer/joins in the existing
 * solver. The scan mode is an internal differential reference, never a policy.
 */
export const createSummaryComponentWorklist = ({ component, dirty, roundLimit, reference = false }) => {
  if (!Array.isArray(component) || !component.length || new Set(component).size !== component.length
    || !Number.isSafeInteger(roundLimit) || roundLimit < 0) throw new TypeError('Invalid summary component worklist.');
  const positions = new Map(component.map((id, index) => [id, index]));
  let rounds = 0, checks = 0, position = -1, started = false;
  const heap = [], queued = new Set(), nextRound = new Set(component.map((_id, index) => index));
  const push = value => {
    if (queued.has(value)) return;
    queued.add(value); let index = heap.length; heap.push(value);
    while (index) {
      const parent = (index - 1) >>> 1;
      if (heap[parent] <= value) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = value;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop(); queued.delete(first);
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
        if (heap[child] >= last) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  const mark = id => {
    const index = positions.get(id);
    if (index === undefined || reference) return;
    if (started && index > position) push(index); else nextRound.add(index);
  };
  const next = () => {
    if (reference) {
      while (true) {
        if (!started || position + 1 === component.length) {
          if (rounds === roundLimit || !component.some(id => { checks++; return dirty.has(id); })) return null;
          rounds++; position = -1; started = true;
        }
        const id = component[++position]; checks++;
        if (dirty.has(id)) return id;
      }
    }
    while (true) {
      if (!heap.length) {
        if (!nextRound.size || rounds === roundLimit) return null;
        rounds++; position = -1; started = true;
        for (const index of nextRound) push(index);
        nextRound.clear();
      }
      position = pop(); checks++;
      const id = component[position];
      if (dirty.has(id)) return id;
    }
  };
  return Object.freeze({ mark, next, snapshot: () => ({ rounds, checks }) });
};
