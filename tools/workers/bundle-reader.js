import { readBundleFile } from '../../src/shared/bundle-io.js';

export default async function readBundle({ bundlePath }) {
  if (!bundlePath) return { ok: false, reason: 'missing bundle path' };
  try {
    const result = await readBundleFile(bundlePath);
    if (!result.ok) return { ok: false, reason: result.reason || 'invalid bundle' };
    return { ok: true, bundle: { chunks: result.bundle.chunks } };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
