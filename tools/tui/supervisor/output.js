/** Observe the supervisor's exact event stream. A failed pipe fences admission,
 * but never throws from a child progress callback before its owner can settle.
 * The existing protocol queue remains the only outbound event queue.
 */
export const createSupervisorOutput = ({ stream = process.stdout, onFailure = () => {} } = {}) => {
  let failure = null;
  let pendingWrites = 0;
  const waiters = new Set();
  const inspect = () => ({ failed: failure !== null, pendingWrites,
    errorCode: failure ? String(failure.code || 'ERR_TUI_OUTPUT') : null });
  const changed = () => { for (const notify of [...waiters]) notify(); };
  const fail = error => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error('Supervisor event transport failed.');
    // The callback owns shutdown; observation is scheduled after the active
    // admission call has installed its real settlement promise in the registry.
    queueMicrotask(() => onFailure(failure));
    changed();
  };
  const onError = error => fail(error);
  const onClose = () => fail(Object.assign(new Error('Supervisor event transport closed.'),
    { code: 'ERR_TUI_OUTPUT_CLOSED' }));
  stream.on('error', onError);
  stream.on('close', onClose);
  const write = value => {
    if (failure) return false;
    pendingWrites += 1;
    let completed = false;
    const complete = error => {
      if (completed) return;
      completed = true;
      pendingWrites -= 1;
      if (error) fail(error);
      changed();
    };
    try { return stream.write(value, complete); }
    catch (error) { complete(error); return false; }
  };
  return { write, inspect,
    assertWritable() { if (failure) throw failure; },
    drain({ timeoutMs = 1000 } = {}) {
      if (failure || pendingWrites === 0) return Promise.resolve({ ...inspect(), complete: !failure && pendingWrites === 0 });
      return new Promise(resolve => {
        let timer;
        const finish = timedOut => {
          if (!timedOut && !failure && pendingWrites > 0) return;
          clearTimeout(timer);
          waiters.delete(notify);
          resolve({ ...inspect(), complete: !failure && pendingWrites === 0, timedOut: timedOut === true });
        };
        const notify = () => finish(false);
        waiters.add(notify);
        timer = setTimeout(() => finish(true), timeoutMs);
      });
    },
    // The process stream is borrowed. Only remove our observers; never destroy
    // another owner's descriptor or claim that a failed write was flushed.
    dispose() { stream.off('error', onError); stream.off('close', onClose); }
  };
};
