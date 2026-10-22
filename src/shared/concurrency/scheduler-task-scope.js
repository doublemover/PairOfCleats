import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage();
const suspendedScopes = new AsyncLocalStorage();
export const runWithSchedulerTaskLease = (lease, operation) => scope.run(lease, operation);
export const currentSchedulerTaskLease = () => scope.getStore() || null;

/** Only explicit known waits suspend compute. Retained bytes, memory tokens and
 * task/window ownership stay with the original task until it actually settles.
 * A nested wait inside the same suspended operation borrows that suspension;
 * parallel waits started by the task itself join the same reacquisition. */
export const withSchedulerCpuSuspended = operation => {
  const lease = scope.getStore();
  if (!lease?.suspendCpu || suspendedScopes.getStore() === lease) return operation();
  return lease.suspendCpu(() => suspendedScopes.run(lease, operation));
};
