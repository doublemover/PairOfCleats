import { stableStringify } from '../../src/shared/stable-json.js';
import { contextEvidenceTerms, contextEvidenceJaccard } from '../../src/context-pack/evidence-similarity.js';

/** Post-hoc evidence measurements. Gold IDs are never passed to pool creation,
 * source qualification, scoring or admission. No model/task outcome is inferred. */
export const summarizeEvidenceControlComparison = (rows, { goldChunkUids } = {}) => {
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('Evidence comparison requires four actual controls.');
  if (goldChunkUids !== undefined && (!Array.isArray(goldChunkUids) || goldChunkUids.some(id => typeof id !== 'string' || !id))) {
    throw new Error('Evidence goldChunkUids requires an explicit array of nonempty chunk identifiers.');
  }
  const identity = row => {
    const { algorithm: _algorithm, ...policy } = row.payload.evidenceSelection.policy;
    const section = row.payload.evidenceSelection, tokens = row.payload.tokenAccounting;
    return stableStringify({ policy, selectorVersion: section.selectorVersion, roleVersion: section.roleVersion,
      similarityVersion: section.similarityVersion, poolDigest: section.poolDigest, profileDigest: tokens.profileDigest,
      maxTokens: tokens.maxTokens, reservedTokens: tokens.reservedTokens, rendering: tokens.rendering,
      primary: row.payload.primary.unit, primaryRef: row.payload.primary.ref, indexSignature: row.payload.provenance.indexSignature });
  };
  const algorithms = new Set(rows.map(row => row.payload.evidenceSelection.policy.algorithm));
  if (algorithms.size !== 4 || rows.some(row => identity(row) !== identity(rows[0]))) throw Object.assign(
    new Error('Evidence controls differ in source pool, versions, mandatory unit, profile or declared budget.'), { code: 'ERR_EVIDENCE_CONTROL_COMPARISON' });
  const gold = goldChunkUids === undefined ? null : new Set(goldChunkUids);
  return { schemaVersion: 1, samePoolIdentity: true, poolDigest: rows[0].payload.evidenceSelection.poolDigest,
    taskOutcomes: { status: 'not-measured', reason: 'No real-model or task-execution evaluation was requested.' },
    controls: rows.map(({ payload, observation }) => {
      const section = payload.evidenceSelection, selected = section.selected, features = selected.map(entry => contextEvidenceTerms(entry.excerpt));
      let overlap = 0, pairs = 0;
      for (let left = 0; left < features.length; left++) for (let right = left + 1; right < features.length; right++) {
        overlap += contextEvidenceJaccard(features[left], features[right]); pairs++;
      }
      const actual = new Set([payload.primary.ref?.chunkUid, ...selected.map(entry => entry.ref.chunkUid)].filter(Boolean));
      const hits = gold ? [...gold].filter(id => actual.has(id)).length : null;
      return { algorithm: section.policy.algorithm, selectedChunkUids: selected.map(entry => entry.ref.chunkUid),
        mandatoryChunkUid: payload.primary.ref?.chunkUid || null, partial: section.partial, stopReason: section.stopReason,
        availableRoles: section.coverage.available, coveredRoles: section.coverage.selected, missingRoles: section.coverage.missing,
        roleCoverage: section.coverage.available.length ? section.coverage.selected.length / section.coverage.available.length : null,
        lexicalRedundancy: pairs ? overlap / pairs : null, redundancyPairs: pairs,
        goldEvidenceRecall: gold ? gold.size ? hits / gold.size : 1 : null,
        exactRenderedTokens: payload.tokenAccounting.renderedTokens, maxTokens: payload.tokenAccounting.maxTokens,
        stats: section.stats, observation: { ...observation, memoryMeaning: 'process snapshots before/after; not a peak or worker heap measurement' } };
    }) };
};
