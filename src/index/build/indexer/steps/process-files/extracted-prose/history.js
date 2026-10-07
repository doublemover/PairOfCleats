import { isExtractedProseDocumentLikeExtension } from '../../../../../chunking/formats/document-common.js';
import {
  EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS,
  buildExtractedProseLowYieldCohort,
  createEmptyCohortStats
} from './cohorts.js';
import { normalizeRepoFingerprint } from './fingerprint.js';

export const normalizeLowYieldCohortStats = (value, fallbackKey = null) => {
  const observedFiles = Math.max(0, Math.floor(Number(value?.observedFiles) || 0));
  const yieldedFiles = Math.min(observedFiles, Math.max(0, Math.floor(Number(value?.yieldedFiles) || 0)));
  const chunkCount = Math.max(0, Math.floor(Number(value?.chunkCount) || 0));
  return {
    key: String(value?.key || fallbackKey || ''),
    ext: typeof value?.ext === 'string' ? value.ext : null,
    pathFamily: typeof value?.pathFamily === 'string' ? value.pathFamily : null,
    docLike: value?.docLike === true,
    warmupFiles: Math.max(0, Math.floor(Number(value?.warmupFiles) || 0)),
    sampledFiles: Math.max(0, Math.floor(Number(value?.sampledFiles) || 0)),
    observedFiles,
    yieldedFiles,
    chunkCount,
    yieldRatio: observedFiles > 0 ? yieldedFiles / observedFiles : 0
  };
};

const normalizeLowYieldHistory = (value) => {
  if (!value || typeof value !== 'object') return null;
  const families = value.families && typeof value.families === 'object' ? value.families : {};
  const cohorts = value.cohorts && typeof value.cohorts === 'object' ? value.cohorts : {};
  const normalizedFamilies = {};
  for (const [familyKey, familyStats] of Object.entries(families)) {
    if (!familyKey || !familyStats || typeof familyStats !== 'object') continue;
    const observedFiles = Math.max(0, Math.floor(Number(familyStats.observedFiles) || 0));
    const yieldedFiles = Math.min(observedFiles, Math.max(0, Math.floor(Number(familyStats.yieldedFiles) || 0)));
    const chunkCount = Math.max(0, Math.floor(Number(familyStats.chunkCount) || 0));
    const [ext = null, pathFamily = null] = String(familyKey).split('|');
    normalizedFamilies[familyKey] = {
      key: familyKey,
      ext,
      pathFamily,
      observedFiles,
      yieldedFiles,
      chunkCount,
      yieldRatio: observedFiles > 0 ? yieldedFiles / observedFiles : 0,
      docLike: isExtractedProseDocumentLikeExtension(ext)
    };
  }
  const derivedCohorts = {};
  for (const familyState of Object.values(normalizedFamilies)) {
    const cohort = buildExtractedProseLowYieldCohort({
      relPath: familyState.pathFamily && familyState.ext
        ? `${familyState.pathFamily}/synthetic${familyState.ext}`
        : null,
      ext: familyState.ext,
      pathFamily: familyState.pathFamily
    });
    const current = normalizeLowYieldCohortStats(derivedCohorts[cohort.key] || createEmptyCohortStats(cohort), cohort.key);
    derivedCohorts[cohort.key] = normalizeLowYieldCohortStats({
      ...current,
      key: cohort.key,
      ext: cohort.ext,
      pathFamily: cohort.pathFamily,
      docLike: cohort.docLike,
      observedFiles: current.observedFiles + familyState.observedFiles,
      yieldedFiles: current.yieldedFiles + familyState.yieldedFiles,
      chunkCount: current.chunkCount + familyState.chunkCount
    }, cohort.key);
  }
  const normalizedCohorts = {};
  for (const cohortKey of EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS) {
    normalizedCohorts[cohortKey] = normalizeLowYieldCohortStats(
      cohorts[cohortKey] || derivedCohorts[cohortKey] || { key: cohortKey },
      cohortKey
    );
  }
  return {
    builds: Math.max(0, Math.floor(Number(value.builds) || 0)),
    observedFiles: Math.max(0, Math.floor(Number(value.observedFiles) || 0)),
    yieldedFiles: Math.max(0, Math.floor(Number(value.yieldedFiles) || 0)),
    chunkCount: Math.max(0, Math.floor(Number(value.chunkCount) || 0)),
    families: normalizedFamilies,
    cohorts: normalizedCohorts,
    fingerprint: normalizeRepoFingerprint(value.fingerprint)
  };
};

export const buildExtractedProseLowYieldHistory = (value) => normalizeLowYieldHistory(value);
export { normalizeLowYieldHistory };
