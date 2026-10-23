/** Bounded observations outlive a process without retaining PID/child authority.
 * Retry and diagnostics stay registered editor actions, never output commands. */
function captureTaskObservation(entry, { status = entry.status, summaryLine = entry.summaryLine,
  completedAt = entry.completedAt || null, observedOnly = entry.observedOnly === true } = {}) {
  const rows = (entry.logTail || []).slice(-128).map(row => Object.freeze({ text: String(row.text || '').slice(0, 8192) }));
  return Object.freeze({ key: entry.key, sessionId: entry.sessionId, repoRoot: entry.repoRoot,
    workspaceUri: entry.workspaceUri || entry.repoUri?.toString?.() || '',
    spec: Object.freeze({ id: entry.spec.id, title: entry.spec.title }),
    status, summaryLine: String(summaryLine || '').slice(0, 2048), completedAt,
    stopping: entry.stopping === true, settling: entry.settling === true,
    cleanupUnconfirmed: entry.cleanupUnconfirmed === true,
    progress: Object.freeze({ ...entry.progress, ...(completedAt ? { phase: status, completedAt } : {}) }),
    logTail: Object.freeze(rows), logTailTruncated: entry.logTailTruncated === true, observedOnly });
}

function createTaskObservations({ maxEntries = 8 } = {}) {
  const recent = [];
  function remember(entry, { status, summaryLine, completedAt = Date.now() }) {
    const observation = captureTaskObservation(entry, { status, summaryLine, completedAt, observedOnly: true });
    const prior = recent.findIndex(row => row.sessionId === observation.sessionId);
    if (prior >= 0) recent.splice(prior, 1);
    recent.unshift(observation);
    recent.splice(maxEntries);
    return observation;
  }
  function list() { return [...recent]; }
  function clear() { recent.length = 0; }
  return { remember, list, clear };
}

function taskRecoveryActions(entry, active) {
  const actions = [{ label: 'Inspect Logs', action: 'logs' },
    { label: 'Open Effective Settings', action: 'settings' },
    { label: 'Tooling Doctor', action: 'doctor' },
    { label: 'Index Health', action: 'health' },
    { label: 'Select Repository', action: 'select' }];
  if (active) actions.splice(1, 0, { label: 'Stop Selected Task', action: 'stop' });
  else if (entry.status === 'failed' && !entry.cleanupUnconfirmed) actions.push({ label: 'Rerun This Saved Workflow', action: 'retry' });
  return actions;
}

module.exports = { captureTaskObservation, createTaskObservations, taskRecoveryActions };
