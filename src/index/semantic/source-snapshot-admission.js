import { canonicalSemanticJson } from './identity.js';
import { createSemanticSourceSnapshot } from './source.js';
import { readSemanticSourceCapability } from './source-capability.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';

/** Verify all source identity/coordinate fields, not merely a byte hash beside caller metadata. */
export const admitOwnedSemanticSourceSnapshot = (snapshot, { maxBytes = 8 * 1024 * 1024, repositoryNamespace = null } = {}) => {
  const capabilityField = snapshot && Object.getOwnPropertyDescriptor(snapshot, 'sourceCapability');
  const manifestField = snapshot && Object.getOwnPropertyDescriptor(snapshot, 'manifest');
  if (!capabilityField || !Object.hasOwn(capabilityField, 'value')
    || !manifestField || !Object.hasOwn(manifestField, 'value')) throw new TypeError('Owned source snapshot data fields required.');
  const source = readSemanticSourceCapability(capabilityField.value);
  if (!source || !manifestField.value || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || source.byteLength > maxBytes) {
    throw new TypeError('Bounded owned semantic source snapshot required.');
  }
  // Canonical encoding rejects getters/custom JSON objects before source metadata is consumed.
  const original = canonicalSemanticJson(manifestField.value);
  if (Buffer.byteLength(original) > maxBytes) throw new RangeError('Semantic source manifest allowance exceeded.');
  const manifest = assertSemanticEnvelope('source', JSON.parse(original));
  if (repositoryNamespace !== null && manifest.repositoryNamespace !== repositoryNamespace) {
    throw new TypeError('Semantic source repository mismatch.');
  }
  const verified = createSemanticSourceSnapshot({ bytes: Buffer.from(source.text), repositoryNamespace: manifest.repositoryNamespace,
    path: manifest.path, language: manifest.language, dialect: manifest.dialect, mapping: manifest.mapping });
  if (canonicalSemanticJson(verified.manifest) !== original) throw new TypeError('Source manifest does not match its owned bytes and identity.');
  return { ...source, manifest: verified.manifest };
};
