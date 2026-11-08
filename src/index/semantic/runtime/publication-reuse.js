import { publishRuntimeControl, isMissingRuntimeMember } from './control-publication.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readRuntimeMemberJson } from './verified-reads.js';
import { runtimeImportError } from './raw-store.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { OFFLINE_RUNTIME_PARSER } from './adapters/shared.js';
import { RUNTIME_QUERY_INDEX_VERSION } from './query-index.js';
import { OFFLINE_RUNTIME_ADAPTERS } from './adapters/inventory.js';

const CONTROL_LIMIT = 4096;

/** Internal work instrumentation, never a source of admission or authority. */
export const createRuntimePublicationWork = (metrics = {}) => {
  for (const key of ['reusedFamilies', 'rebuiltFamilies', 'pointerOnlyRepairs', 'projectionRows', 'sqliteBuilds',
    'verifiedBytes', 'fileWriteBytes', 'sqliteImageBytes', 'peakAdditionalReservation']) metrics[key] = 0;
  return {
    metrics,
    reads: {
      get verificationBytes() { return metrics.verifiedBytes; },
      set verificationBytes(value) { metrics.verifiedBytes = value; },
      get rawVerificationBytes() { return metrics.verifiedBytes; },
      set rawVerificationBytes(value) { metrics.verifiedBytes = value; }
    },
    add(key, amount = 1) { metrics[key] += amount; },
    observeReservation(bytes) { metrics.peakAdditionalReservation = Math.max(metrics.peakAdditionalReservation, bytes); }
  };
};

/** The recipe binds effective input and freshly qualified semantic results.
 * Its receipt locates a candidate; full family verification remains mandatory. */
export const runtimeImportRecipe = (capture, candidates) => semanticHash('pairofcleats.runtime.import-recipe.v1', {
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, parser: OFFLINE_RUNTIME_PARSER,
  adapters: OFFLINE_RUNTIME_ADAPTERS, queryIndexVersion: RUNTIME_QUERY_INDEX_VERSION, capture,
  candidates: candidates.map(candidate => ({ sourceUnitId: candidate.sourceUnitId, sourceHash: candidate.sourceHash,
    targets: candidate.targets, source: candidate.source, targetReason: candidate.targetReason,
    targetRecords: candidate.targetRecords.map(target => ({ ref: target.ref, span: target.span, kind: target.kind,
      scopeKind: target.scopeKind ?? null, astKind: target.astKind ?? null })) }))
});

export const applyRuntimeCoverage = (capture, coverage) => {
  if (coverage.some(row => row.status !== 'complete')) {
    if (capture.completion === 'complete') capture.completion = 'partial';
    capture.warnings = [...new Set([...capture.warnings, 'offline_projection_has_incomplete_coverage'])];
  }
  capture.coverage = [...new Set([...capture.coverage, ...coverage.map(row => row.artifactId + ':' + row.status)])];
  return capture;
};

export const readRuntimeRecipeCandidate = async ({ destination, recipe, signal }) => {
  let receipt;
  try { receipt = (await readRuntimeMemberJson({ root: destination, relativePath: '.recipes/' + recipe + '.json',
    maxBytes: CONTROL_LIMIT, signal })).value; }
  catch (error) { if (isMissingRuntimeMember(error)) return null; throw error; }
  if (receipt?.schemaVersion !== 1) return null; // An older recipe can only request a bounded rebuild.
  if (Object.keys(receipt).sort().join(',') !== 'pointer,recipe,schemaVersion' || receipt.recipe !== recipe) {
    throw runtimeImportError('Runtime recipe locator differs from its admitted request.');
  }
  return receipt.pointer;
};

export const writeRuntimeRecipe = async ({ destination, recipe, pointer, ...options }) => {
  await fs.mkdir(path.join(destination, '.recipes'), { recursive: true });
  return publishRuntimeControl({ ...options, root: destination, relativePath: '.recipes/' + recipe + '.json',
    bytes: Buffer.from(canonicalSemanticJson({ schemaVersion: 1, recipe, pointer }) + '\n') });
};
