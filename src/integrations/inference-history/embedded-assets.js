import { digest } from './common.js';

export const ARCHIVE_ASSET_POLICY_VERSION = 'archive-assets.v1';
const assetField = /^(?:(?:image|audio|video|file|asset|attachment)(?:_?data)?_?base64|base64_?(?:image|audio|video|file|asset|attachment))$/i;
const payloadPattern = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})/gi;
const countOmission = (audit, facts) => {
  if (!audit) return;
  audit.embeddedAssetPayloads = (audit.embeddedAssetPayloads || 0) + 1;
  audit.embeddedAssetEncodedChars = (audit.embeddedAssetEncodedChars || 0) + facts.encoded_chars;
};
const factsFor = (payload, mediaType, audit) => {
  const facts = { omission_reason: 'embedded_asset_payload', media_type: mediaType,
    encoded_chars: payload.length, payload_sha256: digest(payload), policy_version: ARCHIVE_ASSET_POLICY_VERSION };
  countOmission(audit, facts);
  return facts;
};

/** Only explicit asset fields are eligible; arbitrary code/prose strings remain intact. */
export function sanitizeNamedAssetPayload(field, value, audit) {
  if (!assetField.test(field) || typeof value !== 'string' || value.length < 128
    || !/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value)) return null;
  return { embedded_asset_omitted: factsFor(value, 'application/octet-stream', audit) };
}

/** Linear delimited data-URL substitution preserves all surrounding code/prose. */
export function sanitizeEmbeddedAssetText(text, audit) {
  return String(text).replace(payloadPattern, (url, mediaType, payload) => {
    const facts = factsFor(payload, mediaType.toLowerCase(), audit);
    return '[Embedded asset omitted: ' + JSON.stringify(facts) + ']';
  });
}

export function sanitizeEmbeddedAssetValue(value, audit) {
  if (typeof value !== 'string') return value;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  return match ? { embedded_asset_omitted: factsFor(match[2], match[1].toLowerCase(), audit) }
    : sanitizeEmbeddedAssetText(value, audit);
}
