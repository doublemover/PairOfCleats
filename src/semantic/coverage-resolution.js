/** Receipt resolves a deferred marker only when matching actual phase coverage also exists. */
export const resolvePublishedSemanticCoverage = (rows, { generation, completedTasks = [], sourceForPartition }) => {
  const completed = new Set((completedTasks || []).filter(receipt => receipt.baseBuildId === generation.baseBuildId).map(receipt => receipt.taskId));
  const scope = row => row.scope?.sourceUnitId || sourceForPartition(row.partitionId);
  const produced = new Set(rows.filter(row => ['complete','partial'].includes(row.state))
    .map(row => JSON.stringify([scope(row),row.phase])));
  return rows.filter(row => !(row.state === 'deferred' && row.frontierRef && completed.has(row.frontierRef)
    && produced.has(JSON.stringify([scope(row),row.phase]))));
};
