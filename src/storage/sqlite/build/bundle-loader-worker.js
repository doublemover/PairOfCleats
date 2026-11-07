import { validateIncrementalBundleShardAuthority } from '../../../index/build/incremental/bundle-snapshot.js';
import { isMainThread } from 'node:worker_threads';
import { observeWorkerHeap } from '../../../shared/workers/heap-contract.js';
import { measureBundleProjectionBytes } from './bundle-projection-size.js';
import { projectIndexFormatError } from '../../../shared/index-format-error.js';
import { readBundleFile } from '../../../shared/bundle-io.js';

export default async function loadBundleWorker(task) {
  const bundlePath = task && typeof task.bundlePath === 'string'
    ? task.bundlePath
    : '';
  if (!bundlePath) {
    return { ok: false, reason: 'missing bundle path' };
  }
  try {
    if (!isMainThread && !observeWorkerHeap().resourceLimitAcknowledged) return {
      ok: false, heapBoundUnavailable: true, reason: 'bundle worker heap bound was not acknowledged'
    };
    const result = await readBundleFile(bundlePath, { repoRoot: task.repoRoot || process.cwd(), maxBytes: task.maxEncodedBytes, expectedEncodedBytes: task.encodedBytes ?? null, expectedPatchBytes: task.expectedPatchBytes ?? null });
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || 'invalid bundle' };
    }
    if (task.authority && !validateIncrementalBundleShardAuthority({ ...task.authority, bundle: result.bundle })) {
      return { ok: false, reason: 'bundle differs from selected manifest snapshot' };
    }
    const projectionBytes = measureBundleProjectionBytes(result.bundle, task.maxProjectionBytes);
    return { ok: true, bundle: result.bundle, projectionBytes };
  } catch (err) {
    const format = projectIndexFormatError(err);
    if (format) return { ok: false, formatError: { message: err.message, ...format } };
    return { ok: false, reason: err?.message || String(err), errorCode: err?.code || null };
  }
}
