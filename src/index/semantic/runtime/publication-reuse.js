import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';
import { describeStorageFailure } from '../../../shared/storage/failure-observation.js';
import { closeRuntimeResources } from './close-resources.js';
import { readRuntimeMemberBytes, readRuntimeMemberJson } from './verified-reads.js';
import { assertRuntimeDiskReserve, runtimeImportError } from './raw-store.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { OFFLINE_RUNTIME_PARSER } from './adapters/shared.js';
import { RUNTIME_QUERY_INDEX_VERSION } from './query-index.js';
import { OFFLINE_RUNTIME_ADAPTERS } from './adapters/inventory.js';

const CONTROL_LIMIT = 4096;
export const isMissingRuntimeMember = error => describeStorageFailure(error).code === 'ENOENT';

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

/** One bounded control replacement under the existing destination writer.
 * Its final physical inventory owns replaced-file credits: a rename alone
 * cannot prove the old inode lost every other retained hardlink. */
export const publishRuntimeControl = async ({ root, relativePath, bytes, account, diskReserveBytes,
  work, signal = null, check = () => throwIfAborted(signal), publicationState = null }) => {
  check();
  if (bytes.length > CONTROL_LIMIT) throw runtimeImportError('Runtime publication control exceeds its allowance.');
  let old = null;
  try { old = (await readRuntimeMemberBytes({ root, relativePath, maxBytes: CONTROL_LIMIT, signal })).buffer; }
  catch (error) { if (!isMissingRuntimeMember(error)) throw error; }
  check();
  if (old?.equals(bytes)) {
    if (publicationState) publicationState.pointerState = 'committed';
    return false;
  }
  const filename = path.join(root, relativePath), temporary = path.join(path.dirname(filename), '.current-' + randomUUID());
  await assertRuntimeDiskReserve({ destination: root, diskReserveBytes, additionalBytes: bytes.length });
  check(); account.reserve(bytes.length);
  let published = false, failed = false, failure;
  try {
    const handle = await fs.open(temporary, 'wx');
    let writeFailed = false, writeFailure;
    try {
      check(); await handle.writeFile(bytes); work.add('fileWriteBytes', bytes.length);
      check(); await handle.sync(); check();
    } catch (error) { writeFailed = true; writeFailure = error; throw error; }
    finally { await closeRuntimeResources([handle], writeFailure, { hasOperationError: writeFailed }); }
    check();
    if (publicationState) publicationState.pointerState = 'commit-unconfirmed';
    await fs.rename(temporary, filename); published = true;
    if (publicationState) publicationState.pointerState = 'committed';
    check(); return true;
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    await closeRuntimeResources([{ close: async () => {
      await fs.rm(temporary, { force: true });
      if (!published) account.release(bytes.length);
    } }], failure, { hasOperationError: failed });
  }
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
