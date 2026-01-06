import fs from 'node:fs/promises';
import path from 'node:path';
import { Packr, Unpackr } from 'msgpackr';
import { sha1, checksumString } from './hash.js';
import { stableStringify } from './stable-json.js';

const BUNDLE_FORMAT_TAG = 'pairofcleats.bundle';
const BUNDLE_VERSION = 1;
const MSGPACK_EXTENSIONS = new Set(['.mpk', '.msgpack', '.msgpackr']);

const packr = new Packr({ useRecords: false, structuredClone: true });
const unpackr = new Unpackr({ useRecords: false });

const normalizeBundlePayload = (value) => {
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

const checksumBundlePayload = async (payload) => (
  checksumString(stableStringify(payload))
);

export function normalizeBundleFormat(raw) {
  if (typeof raw !== 'string') return 'json';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'msgpack' || normalized === 'msgpackr' || normalized === 'mpk') {
    return 'msgpack';
  }
  return 'json';
}

export function resolveBundleFilename(relKey, format) {
  const ext = format === 'msgpack' ? 'mpk' : 'json';
  return `${sha1(relKey)}.${ext}`;
}

export function resolveBundleFormatFromName(bundleName, fallback = 'json') {
  if (typeof bundleName !== 'string' || !bundleName) return fallback;
  const ext = path.extname(bundleName).toLowerCase();
  return MSGPACK_EXTENSIONS.has(ext) ? 'msgpack' : 'json';
}

export async function writeBundleFile({ bundlePath, bundle, format = 'json' }) {
  const resolvedFormat = normalizeBundleFormat(format);
  if (resolvedFormat === 'msgpack') {
    const normalized = normalizeBundlePayload(bundle);
    const checksum = await checksumBundlePayload(normalized);
    const envelope = {
      format: BUNDLE_FORMAT_TAG,
      version: BUNDLE_VERSION,
      checksum: checksum ? { algo: checksum.algo, value: checksum.value } : null,
      payload: normalized
    };
    const encoded = packr.pack(envelope);
    await fs.writeFile(bundlePath, Buffer.from(encoded));
    return {
      format: resolvedFormat,
      checksum: checksum?.value ?? null,
      checksumAlgo: checksum?.algo ?? null
    };
  }
  await fs.writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
  return { format: resolvedFormat, checksum: null, checksumAlgo: null };
}

export async function readBundleFile(bundlePath, { format = null } = {}) {
  const resolvedFormat = format || resolveBundleFormatFromName(bundlePath);
  if (resolvedFormat === 'msgpack') {
    const buffer = await fs.readFile(bundlePath);
    const envelope = unpackr.unpack(buffer);
    if (!envelope || typeof envelope !== 'object') {
      return { ok: false, reason: 'invalid bundle envelope' };
    }
    if (envelope.format !== BUNDLE_FORMAT_TAG || envelope.version !== BUNDLE_VERSION) {
      return { ok: false, reason: 'unsupported bundle envelope' };
    }
    const payload = envelope.payload;
    if (!payload || !Array.isArray(payload.chunks)) {
      return { ok: false, reason: 'invalid bundle payload' };
    }
    const checksum = envelope.checksum?.value;
    if (checksum) {
      const normalized = normalizeBundlePayload(payload);
      if (envelope.checksum?.algo === 'xxh64') {
        const expected = await checksumBundlePayload(normalized);
        if (!expected || expected.value !== checksum) {
          return { ok: false, reason: 'bundle checksum mismatch' };
        }
        return { ok: true, bundle: normalized };
      }
      if (envelope.checksum?.algo === 'sha1') {
        const expected = sha1(stableStringify(normalized));
        if (expected !== checksum) {
          return { ok: false, reason: 'bundle checksum mismatch' };
        }
        return { ok: true, bundle: normalized };
      }
    }
    return { ok: true, bundle: payload };
  }
  const raw = await fs.readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(raw);
  if (!bundle || !Array.isArray(bundle.chunks)) {
    return { ok: false, reason: 'invalid bundle' };
  }
  return { ok: true, bundle };
}
