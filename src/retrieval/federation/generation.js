import { sha1 } from '../../shared/hash.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import path from 'node:path';
import { toRealPathSync } from '../../workspace/identity.js';
import { parseSearchArgs } from '../cli-args.js';
import { buildRepoModePlans } from './modes.js';
import { captureAdmittedSearchGeneration, INTERNAL_ADMITTED_GENERATION } from '../../index/as-of.js';

const payloadKeys = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };

const hasHistoricalSelector = args => {
  const parsed = parseSearchArgs(args);
  return parsed.snapshot != null || (parsed['as-of'] != null && parsed['as-of'] !== 'latest');
};

const admittedBuildSelection = (manifestRepo, mode) => {
  const root = manifestRepo?.indexes?.[mode]?.indexRoot;
  const buildId = typeof root === 'string' ? path.basename(root) : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(buildId) || !manifestRepo?.repoCacheRoot) {
    throw createError(ERROR_CODES.INVALID_REQUEST,
      `Repository ${manifestRepo?.repoId || '<unknown>'} ${mode} admitted root cannot be pinned to a retained build. Restart after rebuilding this mode.`);
  }
  const admittedGeneration = captureAdmittedSearchGeneration({
    repoRoot: manifestRepo.repoRootCanonical, requestedModes: [mode], expectedRootsByMode: { [mode]: root }
  });
  if (toRealPathSync(path.join(manifestRepo.repoCacheRoot, 'builds', buildId)) === toRealPathSync(root)) {
    return { root, indexRef: `build:${buildId}` };
  }
  return { root, admittedGeneration };
};

/** Split a combined mode call when its admitted roots belong to different builds. */
export const buildPinnedFederatedModePlans = ({ modes, manifestRepo, args }) => {
  if (hasHistoricalSelector(args)) return buildRepoModePlans(modes);
  const groups = new Map();
  for (const mode of modes) {
    const selection = admittedBuildSelection(manifestRepo, mode);
    if (!groups.has(selection.root)) groups.set(selection.root, { selection, modes: [] });
    groups.get(selection.root).modes.push(mode);
  }
  return [...groups.values()].flatMap(({ selection, modes }) => buildRepoModePlans(modes)
    .map(plan => ({ ...plan, ...selection })));
};

/** Insert an existing immutable build selector before the preserved option tail. */
export const bindFederatedBuildRef = (args, indexRef) => {
  if (!indexRef) return args;
  const marker = args.indexOf('--');
  const options = marker < 0 ? args : args.slice(0, marker);
  const output = [];
  for (let index = 0; index < options.length; index++) {
    if (options[index] === '--as-of') { index++; continue; }
    if (!options[index].startsWith('--as-of=')) output.push(options[index]);
  }
  return [...output, '--as-of', indexRef, ...(marker < 0 ? [] : args.slice(marker))];
};

export const bindFederatedModeGeneration = (args, manifestRepo, mode) => {
  if (hasHistoricalSelector(args)) return args;
  const selection = admittedBuildSelection(manifestRepo, mode);
  if (!selection.indexRef) throw createError(ERROR_CODES.INVALID_REQUEST, 'This generation requires an admitted request binding.');
  return bindFederatedBuildRef(args, selection.indexRef);
};

export const bindFederatedModeRequest = (args, manifestRepo, mode) => {
  const selection = hasHistoricalSelector(args) ? {} : admittedBuildSelection(manifestRepo, mode);
  return { args: bindFederatedBuildRef(args, selection.indexRef),
    options: { [INTERNAL_ADMITTED_GENERATION]: selection.admittedGeneration } };
};

/**
 * Core search records the signature of each directory it actually selected.
 * Check that evidence before admitting hits, including when current pointers
 * changed and returned to their original value during the child request.
 * Custom search collaborators may omit retrieval metadata; they remain trusted
 * producers of the explicitly bound child request.
 */
export const verifyFederatedModeGeneration = ({ repoId, modes, result, manifestRepo }) => {
  const byMode = result?.retrieval?.freshness?.byMode;
  if (byMode == null) return;
  for (const mode of modes) {
    const expected = manifestRepo?.indexes?.[mode]?.indexSignatureHash;
    const observed = byMode[payloadKeys[mode]]?.signature;
    if (typeof expected !== 'string' || typeof observed !== 'string' || `is1-${sha1(observed)}` !== expected) {
      throw createError(ERROR_CODES.INVALID_REQUEST,
        `Repository ${repoId} ${mode} generation does not match workspace admission. Restart the search.`);
    }
  }
};
