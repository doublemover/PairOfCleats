import { MAX_JSON_BYTES, readJsonFile } from '../../src/shared/artifact-io.js';

export default function readBundle({ bundlePath }) {
  if (!bundlePath) return { ok: false, reason: 'missing bundle path' };
  try {
    const bundle = readJsonFile(bundlePath, { maxBytes: MAX_JSON_BYTES });
    if (!bundle || !Array.isArray(bundle.chunks)) {
      return { ok: false, reason: 'invalid bundle' };
    }
    return { ok: true, bundle: { chunks: bundle.chunks } };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
