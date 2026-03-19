import { terminateTrackedSubprocesses } from '../../../shared/subprocess.js';

export const waitForPromisesWithTimeout = async (promises, timeoutMs) => {
  if (!Array.isArray(promises) || promises.length === 0) {
    return { timedOut: false, settled: [] };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const settled = await Promise.allSettled(promises);
    return { timedOut: false, settled };
  }
  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true, settled: null }), timeoutMs);
  });
  const settledPromise = Promise.allSettled(promises)
    .then((settled) => ({ timedOut: false, settled }));
  try {
    const raced = await Promise.race([settledPromise, timeoutPromise]);
    if (raced?.timedOut === true) return { timedOut: true, settled: [] };
    return { timedOut: false, settled: Array.isArray(raced?.settled) ? raced.settled : [] };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export const forceCleanupTrackedPreflightProcesses = async ({ inFlightEntries, log }) => {
  const ownershipIds = [...new Set(
    (Array.isArray(inFlightEntries) ? inFlightEntries : [])
      .map(([, entry]) => (typeof entry?.ownershipId === 'string' ? entry.ownershipId.trim() : ''))
      .filter(Boolean)
  )];
  const forcedCleanup = {
    ownershipIds: ownershipIds.length,
    attempted: 0,
    terminated: 0,
    failures: 0
  };
  for (const ownershipId of ownershipIds) {
    try {
      const cleanup = await terminateTrackedSubprocesses({
        reason: 'tooling_preflight_teardown_timeout',
        force: true,
        ownershipId
      });
      forcedCleanup.attempted += Number(cleanup?.attempted || 0);
      forcedCleanup.terminated += Number(cleanup?.terminatedPids?.length || 0);
      forcedCleanup.failures += Number(cleanup?.failures || 0);
    } catch {
      forcedCleanup.failures += 1;
    }
  }
  if ((forcedCleanup.attempted > 0 || forcedCleanup.failures > 0) && typeof log === 'function') {
    log(
      `[tooling] preflight:teardown_force_cleanup ownershipIds=${forcedCleanup.ownershipIds} `
      + `attempted=${forcedCleanup.attempted} terminated=${forcedCleanup.terminated} failures=${forcedCleanup.failures}`
    );
  }
  return forcedCleanup;
};
