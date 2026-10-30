import { Piscina, queueOptionsSymbol } from 'piscina';
import type { Worker } from 'node:worker_threads';

// Compile against the locked dependency's exported constructor/API. No import
// from dist/worker_pool, WorkerInfo, private symbols, or undocumented task state.
const pool = new Piscina({ concurrentTasksPerWorker: 1,
  loadBalancer(task, workers) {
    const metadata: unknown = task[queueOptionsSymbol];
    void metadata;
    // @ts-expect-error An arbitrary symbol is not the exported task metadata API.
    void task[Symbol('unregistered-task-metadata')];
    const selected = workers.find(worker => worker.currentUsage === 0);
    if (selected) { const originalId: number = selected.id; void originalId; }
    return selected || null;
  }
});
const originalWorkers: readonly Worker[] = pool.threads;
for (const worker of originalWorkers) {
  const id: number = worker.threadId; void id;
  worker.once('exit', (code: number) => { void code; });
}
const payload = { text: 'fixture', [queueOptionsSymbol]: { original: true } };
void pool.run(payload, { signal: AbortSignal.abort() });
void pool.destroy();
