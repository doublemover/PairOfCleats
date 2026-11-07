/** Validate only associations already present in a schema-admitted page. */
export const runtimeQueryProjectionErrors = result => {
  const errors = [], occurrences = new Map();
  const key = (reference, evidenceId) => reference.family + '\0' + evidenceId;
  const familyFor = (reference, captureId = null, generationId = null) => {
    const family = result.pinnedFamilies[reference.family];
    if (!family || (captureId !== null && family.captureId !== captureId)
      || (generationId !== null && family.generationId !== generationId)) errors.push('Evidence reference does not resolve to its pinned family.');
    return family;
  };
  for (const row of [...result.observations, ...result.derivedClaims]) {
    familyFor(row.reference, row.captureId);
    const identity = key(row.reference, row.evidenceId);
    if (occurrences.has(identity)) errors.push('A family occurrence is duplicated.');
    occurrences.set(identity, row.reference.rowHash);
  }
  for (const explanation of result.explanations) {
    if (JSON.stringify(explanation.evidenceIds) !== JSON.stringify(explanation.evidenceRefs.map(ref => ref.evidenceId))) {
      errors.push('Explanation logical IDs differ from its qualified references.');
    }
    for (const ref of explanation.evidenceRefs) if (occurrences.get(key(ref, ref.evidenceId)) !== ref.rowHash) {
      errors.push('Explanation does not resolve to the returned family occurrence.');
    }
  }
  for (const omitted of result.omitted) {
    familyFor(omitted.reference, null, omitted.generationId);
    if (occurrences.has(key(omitted.reference, omitted.evidenceId))) errors.push('An omitted occurrence is also returned.');
  }
  for (const coverage of result.coverage) {
    if (coverage.sourceJoinCountsScope !== 'family') errors.push('Global source counts must declare their family scope.');
    for (const source of coverage.requestedSources) {
      const expected = !coverage.selected ? 'not-selected' : !source.snapshotPresent ? 'absent-from-snapshot'
        : source.retainedExactCount > 0 ? 'retained-exact-observations' : 'no-retained-exact-observations';
      if (source.state !== expected || (coverage.selected ? source.retainedExactCount === null : source.retainedExactCount !== null)) {
        errors.push('Requested source qualification disagrees with its captured facts.');
      }
      if (coverage.selected && expected !== 'retained-exact-observations' && result.status === 'complete') {
        errors.push('Complete status erases an unavailable requested source.');
      }
    }
  }
  return errors;
};
