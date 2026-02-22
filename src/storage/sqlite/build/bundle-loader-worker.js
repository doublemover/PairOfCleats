import { readBundleFile } from '../../../shared/bundle-io.js';

export default async function loadBundleWorker(task) {
  const bundlePath = task && typeof task.bundlePath === 'string'
    ? task.bundlePath
    : '';
  if (!bundlePath) {
    return { ok: false, reason: 'missing bundle path' };
  }
  try {
    const result = await readBundleFile(bundlePath);
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || 'invalid bundle' };
    }
    return { ok: true, bundle: result.bundle };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
