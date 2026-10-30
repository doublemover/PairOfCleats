/** Opt-in worker ownership aggregate. The general lifecycle registry deliberately
 * remains one-shot; failed original worker owners need explicit retry instead. */
export const createWorkerCleanupGroup = owners => {
  const entries = owners.map(owner => ({ ...owner, closed: false, diagnosticPresent: false, diagnostic: undefined }));
  let closing = null;
  const isSettled = () => entries.every(entry => entry.closed);
  const destroy = () => {
    if (closing) return closing;
    closing = (async () => {
      const failures = [];
      for (const entry of entries) {
        if (entry.closed) {
          if (entry.diagnosticPresent) failures.push(entry.diagnostic);
          continue;
        }
        try { await entry.close(); entry.closed = true; }
        catch (error) {
          // A post-close diagnostic is observable but never authorizes another
          // physical close. Missing/broken settlement evidence fails closed.
          let inspection, inspectionFailed = false;
          try { entry.closed = entry.isSettled?.() === true; }
          catch (failure) { entry.closed = false; inspection = failure; inspectionFailed = true; }
          if (entry.closed) { entry.diagnosticPresent = true; entry.diagnostic = error; }
          failures.push(error);
          if (inspectionFailed) failures.push(inspection);
        }
      }
      if (!failures.length) return;
      if (isSettled()) {
        if (failures.length === 1) throw failures[0];
        throw new AggregateError(failures, 'Worker cleanup completed with diagnostic failures.', { cause: failures[0] });
      }
      throw Object.assign(new AggregateError(failures, 'Original worker cleanup ownership remains retained.', { cause: failures[0] }), {
        code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', cacheOwnershipPending: true,
        cacheOwnershipReleased: isSettled,
        workerOwnershipPending: true, workerOwnershipReleased: isSettled
      });
    })().catch(error => { if (!isSettled()) closing = null; throw error; });
    return closing;
  };
  return { destroy, isSettled };
};
