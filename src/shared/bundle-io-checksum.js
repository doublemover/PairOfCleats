import { checksumString, sha1 } from './hash.js';
import { estimateJsonBytes } from './cache/size.js';
import { canonicalizeBundlePayloadForChecksum } from './bundle-checksum.js';
import { stableStringify } from './stable-json.js';

const isPlainObject = (value) => !!value && typeof value === 'object' && value.constructor === Object;

export const normalizeBundlePayload = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBundlePayload(entry));
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeBundlePayload(value[key]);
  }
  return out;
};

export const estimatePayloadBytes = (value) => {
  const estimate = estimateJsonBytes(value);
  if (!Number.isFinite(estimate) || estimate <= 0) return 0;
  return Math.floor(estimate);
};

export const checksumBundlePayloadLocal = async (payload, { maxChecksumBytes }) => {
  const estimate = estimatePayloadBytes(payload);
  if (estimate && estimate > maxChecksumBytes) return null;
  const canonical = canonicalizeBundlePayloadForChecksum(payload);
  return checksumString(stableStringify(canonical));
};

export const isSupportedChecksumSchemaVersion = (value, supportedVersion) => (
  value == null || value === '' || Number(value) === supportedVersion
);

export const readChecksumDescriptor = (value, supportedVersion) => {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'invalid bundle checksum' };
  }
  if (!isSupportedChecksumSchemaVersion(value.schemaVersion, supportedVersion)) {
    return { ok: false, reason: 'unsupported bundle checksum schema' };
  }
  const algo = typeof value.algo === 'string' ? value.algo.trim() : '';
  const checksumValue = typeof value.value === 'string' ? value.value.trim() : '';
  if (!algo || !checksumValue) {
    return { ok: false, reason: 'invalid bundle checksum' };
  }
  return { ok: true, checksum: { algo, value: checksumValue } };
};

export const verifyBundleChecksum = async ({
  bundle,
  checksum,
  supportedVersion,
  maxChecksumBytes,
  checksumBundlePayload
}) => {
  const normalized = normalizeBundlePayload(bundle);
  const estimate = estimateJsonBytes(normalized);
  if (estimate && estimate > maxChecksumBytes) {
    return { ok: true, bundle: normalized, verificationSkipped: true };
  }
  if (checksum.algo === 'xxh64') {
    const expected = await checksumBundlePayload(normalized);
    if (!expected || expected.value !== checksum.value) {
      return { ok: false, reason: 'bundle checksum mismatch' };
    }
    return { ok: true, bundle: normalized };
  }
  if (checksum.algo === 'sha1') {
    const expected = sha1(stableStringify(normalized));
    if (expected !== checksum.value) {
      return { ok: false, reason: 'bundle checksum mismatch' };
    }
    return { ok: true, bundle: normalized };
  }
  return { ok: false, reason: 'unsupported bundle checksum algo' };
};
