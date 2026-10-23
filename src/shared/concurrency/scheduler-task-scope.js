import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage();
const suspendedScopes = new AsyncLocalStorage();
export const runWithSchedulerTaskLease = (lease, operation) => scope.run(lease, operation);
export const currentSchedulerTaskLease = () => scope.getStore() || null;
/** Independently drained queues must not inherit one producer's file lease.
 * The receiving owner still retains its own work, bytes and close obligations;
 * this boundary is not for unowned task continuations or native worker compute.
 */
export const runWithIndependentSchedulerOwner = operation => scope.run(null,
  () => suspendedScopes.run(null, operation));

/** Only explicit known waits suspend compute. Retained bytes, memory tokens and
 * task/window ownership stay with the original task until it actually settles.
 * A nested wait inside the same suspended operation borrows that suspension;
 * parallel waits started by the task itself join the same reacquisition. */
export const withSchedulerCpuSuspended = operation => {
  const lease = scope.getStore();
  if (!lease?.suspendCpu) return operation();
  if (suspendedScopes.getStore() === lease) return lease.trackWait ? lease.trackWait(operation) : operation();
  return lease.suspendCpu(() => suspendedScopes.run(lease, operation));
};
