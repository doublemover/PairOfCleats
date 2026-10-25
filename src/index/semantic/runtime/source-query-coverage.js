/** Counts inspect indexed keys only; they never hydrate saved evidence rows. */
export const qualifyRuntimeRequestedSources = ({ family, sources, selected, metrics, check }) => {
  if (!sources.length) return [];
  const inventory = new Set(family.capture.sources.map(source => source.sourceUnitId + '\0' + source.byteHash));
  const count = selected && sources.length ? family.db.prepare("SELECT count(*) AS count FROM evidence INDEXED BY evidence_source WHERE source_unit_id=? AND source_hash=? AND join_quality='exact-source'") : null;
  return sources.map(source => {
    check();
    const snapshotPresent = inventory.has(source.sourceUnitId + '\0' + source.byteHash);
    let retainedExactCount = null, state = 'not-selected', reasons = [];
    if (selected) {
      metrics.sourcePredicates += 1;
      retainedExactCount = count.get(source.sourceUnitId, source.byteHash).count;
      state = !snapshotPresent ? 'absent-from-snapshot' : retainedExactCount > 0
        ? 'retained-exact-observations' : 'no-retained-exact-observations';
      if (!snapshotPresent) reasons = ['requested_source_not_in_capture_snapshot'];
      else if (retainedExactCount === 0) reasons = ['no_retained_exact_source_observations'];
    }
    return { ...source, snapshotPresent, retainedExactCount, state, reasons, executionCoverage: 'unknown' };
  });
};
