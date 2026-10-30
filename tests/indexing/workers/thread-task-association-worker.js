import { threadId } from 'node:worker_threads';
export default ({ gate, tag }) => {
  if (gate) {
    const flags = new Int32Array(gate);
    Atomics.store(flags, 0, 1); Atomics.notify(flags, 0);
    while (Atomics.load(flags, 1) === 0) Atomics.wait(flags, 1, 0);
  }
  return { threadId, tag };
};
