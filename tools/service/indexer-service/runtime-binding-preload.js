import { installRuntimeBindingProcessObserver } from '../../../src/shared/runtime-envelope/execution-binding.js';
import { isMainThread } from 'node:worker_threads';

// Installed only by the service executor, with a dedicated IPC descriptor.
// No message listener is added: IPC must not extend the build's lifetime.
// Forks can inherit --import. Only the direct executor child owns this channel;
// descendants and worker threads must retain their existing IPC protocols.
const executorPid = new URL(import.meta.url).searchParams.get('executorPid');
if (isMainThread && executorPid === String(process.ppid) && typeof process.send === 'function') installRuntimeBindingProcessObserver(binding => {
  if (process.connected) process.send(binding, () => {});
});
