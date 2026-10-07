import fs from 'node:fs/promises';
import { Unpackr } from 'msgpackr';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  BUNDLE_FORMAT_TAG,
  BUNDLE_VERSION
} from '../bundle-io-constants.js';
import {
  isSupportedChecksumSchemaVersion,
  readChecksumDescriptor,
  verifyBundleChecksum
} from '../bundle-io-checksum.js';
import {
  resolveBundleFormatFromName,
  resolveBundleJsonChecksumPath
} from '../bundle-io-paths.js';
import {
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_CHECKSUM_BYTES
} from '../bundle-contract.js';
import { checksumBundlePayload } from './support.js';
import { applyBundlePatch, readBundlePatches } from './patch.js';

const unpackr = new Unpackr({ useRecords: false });

export async function readBundleFile(bundlePath, { format = null, maxBytes = MAX_BUNDLE_BYTES } = {}) {
  const stat = await fs.stat(bundlePath);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && stat.size > maxBytes) {
    return { ok: false, reason: 'bundle too large' };
  }
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
    const checksumEnvelope = envelope.checksum;
    if (checksumEnvelope != null) {
      const descriptor = readChecksumDescriptor(
        checksumEnvelope,
        BUNDLE_CHECKSUM_SCHEMA_VERSION
      );
      if (!descriptor.ok) {
        return descriptor;
      }
      return verifyBundleChecksum({
        bundle: payload,
        checksum: descriptor.checksum,
        supportedVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
        maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES,
        checksumBundlePayload
      });
    }
    return { ok: true, bundle: payload };
  }
  const raw = await fs.readFile(bundlePath, 'utf8');
  let bundle = null;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid bundle' };
  }
  if (!bundle || !Array.isArray(bundle.chunks)) {
    return { ok: false, reason: 'invalid bundle' };
  }
  const patches = await readBundlePatches(bundlePath);
  if (!patches.ok) {
    return { ok: false, reason: 'invalid bundle patch' };
  }
  if (patches.patches.length) {
    let patchedBundle = bundle;
    try {
      for (const patch of patches.patches) {
        patchedBundle = applyBundlePatch({ bundle: patchedBundle, patch });
      }
    } catch {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    if (!patchedBundle || !Array.isArray(patchedBundle.chunks)) {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    bundle = patchedBundle;
  }
  try {
    const checksumPath = resolveBundleJsonChecksumPath(bundlePath);
    const rawChecksum = await fs.readFile(checksumPath, 'utf8');
    const parsedChecksum = JSON.parse(rawChecksum);
    const checksum = parsedChecksum?.checksum;
    if (!isSupportedChecksumSchemaVersion(
      parsedChecksum?.checksumSchemaVersion,
      BUNDLE_CHECKSUM_SCHEMA_VERSION
    )) {
      return { ok: false, reason: 'unsupported bundle checksum schema' };
    }
    const descriptor = readChecksumDescriptor(checksum, BUNDLE_CHECKSUM_SCHEMA_VERSION);
    if (!descriptor.ok) {
      return descriptor;
    }
    const verified = await verifyBundleChecksum({
      bundle,
      checksum: descriptor.checksum,
      supportedVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
      maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES,
      checksumBundlePayload
    });
    if (!verified.ok) {
      return verified;
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      return { ok: false, reason: 'invalid bundle checksum' };
    }
  }
  return { ok: true, bundle };
}
