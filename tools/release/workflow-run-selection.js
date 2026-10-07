const toTime = (value) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
};

const compareRunsDesc = (left, right) => (
  toTime(right?.updatedAt) - toTime(left?.updatedAt)
  || toTime(right?.createdAt) - toTime(left?.createdAt)
  || Number(right?.databaseId || 0) - Number(left?.databaseId || 0)
);

export function selectLatestWorkflowRunGateState(payload) {
  const runs = Array.isArray(payload) ? [...payload] : [];
  if (runs.length === 0) {
    return { kind: 'missing', text: 'missing', runId: null };
  }

  runs.sort(compareRunsDesc);
  const latest = runs[0] || null;
  if (!latest) {
    return { kind: 'missing', text: 'missing', runId: null };
  }

  if (latest.status === 'completed' && latest.conclusion === 'success') {
    return {
      kind: 'success',
      text: `success:${latest.databaseId}`,
      runId: latest.databaseId,
      run: latest
    };
  }

  if (latest.status === 'completed') {
    return {
      kind: 'failed',
      text: `failed:${latest.databaseId}:${latest.conclusion || 'unknown'}`,
      runId: latest.databaseId,
      run: latest
    };
  }

  return {
    kind: 'pending',
    text: `pending:${latest.databaseId}:${latest.status || 'unknown'}`,
    runId: latest.databaseId,
    run: latest
  };
}
