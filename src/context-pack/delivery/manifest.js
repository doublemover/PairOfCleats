import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { captureSourcePath } from '../../semantic/source-order.js';
import { CONTEXT_DELIVERY_SCHEMAS, CONTEXT_DELIVERY_VERSION } from '../../contracts/schemas/context-delivery.js';
import { assertContextDelivery } from '../../contracts/validators/context-delivery.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../response-budget.js';

export const deliveryError = (reason, message) => Object.assign(new Error(message), { code: 'ERR_CONTEXT_DELIVERY_' + reason.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(), reason });
export const deliveryJson = value => canonicalSemanticJson(value, { maxBytes: 4 * CONTEXT_PACK_RESPONSE_MAX_BYTES });
export const deliveryDigest = (domain, value) => semanticHash('context-delivery.' + domain + '.v1', value, { maxBytes: 4 * CONTEXT_PACK_RESPONSE_MAX_BYTES });
export const deliveryBytes = value => Buffer.byteLength(deliveryJson(value)) + 1;
export const captureDelivery = (kind, value) => assertContextDelivery(kind, captureSemanticRequest(value, CONTEXT_DELIVERY_SCHEMAS[kind]));
export const deliveryContentHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const wholeUnicode = text => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
export const describeDeliveryEntry = input => {
  const { text, ...metadata } = captureDelivery('entry', input);
  if (!wholeUnicode(text)) throw deliveryError('RepresentationMismatch', 'Evidence delivery requires complete Unicode scalars.');
  if (metadata.representation === 'exact-source') {
    if (!metadata.source || metadata.source.coordinateUnit !== 'utf16' || metadata.source.span[1] - metadata.source.span[0] !== text.length) {
      throw deliveryError('RepresentationMismatch', 'Exact source delivery requires its original UTF-16 source interval.');
    }
    captureSourcePath(metadata.source.path);
  } else if (metadata.source !== null) throw deliveryError('RepresentationMismatch', 'A synopsis or rendered answer cannot masquerade as an exact source interval.');
  const value = { ...metadata, contentHash: deliveryContentHash(text), bodyBytes: Buffer.byteLength(text) };
  const descriptor = assertContextDelivery('descriptor', { ...value, id: deliveryDigest('entry', value) });
  return { descriptor, body: { id: descriptor.id, text } };
};

/** Only already-admitted evidence. These pure operations establish exact
 * representation/reconstruction integrity, never source or host authority. */
export const buildEvidenceWindow = (input, evidence, { signal = null } = {}) => {
  const request = captureDelivery('request', input); throwIfAborted(signal);
  if (!Array.isArray(evidence) || evidence.length > 128) throw deliveryError('MandatoryOverflow', 'Evidence window entry allowance exceeded.');
  if (Object.keys(evidence).length !== evidence.length || Object.getOwnPropertySymbols(evidence).length) throw deliveryError('RepresentationMismatch', 'Decorated evidence arrays are not JSON.');
  const described = [], ids = new Set(); let retainedBytes = 0;
  for (let index = 0; index < evidence.length; index++) {
    throwIfAborted(signal);
    const property = Object.getOwnPropertyDescriptor(evidence, String(index));
    if (!property || !Object.hasOwn(property, 'value')) throw deliveryError('RepresentationMismatch', 'Sparse or accessor evidence entries are not admitted.');
    const entry = describeDeliveryEntry(property.value);
    if (ids.has(entry.descriptor.id)) throw deliveryError('RepresentationMismatch', 'Duplicate delivery identity is not a distinct observation.');
    ids.add(entry.descriptor.id); described.push(entry); retainedBytes += deliveryBytes(entry);
    if (retainedBytes > request.limits.reconstructedBytes) throw deliveryError('MandatoryOverflow', 'Required evidence bodies exceed complete reconstruction allowance.');
  }
  const exactRoles = new Set(described.filter(entry => entry.descriptor.representation === 'exact-source').flatMap(entry => entry.descriptor.roles));
  const unresolvedRoles = [...new Set([...request.unresolvedRoles, ...request.requiredExactSourceRoles.filter(role => !exactRoles.has(role))])];
  if (unresolvedRoles.length > 64) throw deliveryError('MandatoryOverflow', 'Required unresolved roles exceed the complete manifest allowance.');
  const manifest = { schemaVersion: CONTEXT_DELIVERY_VERSION, kind: 'evidence-window-manifest', contextRef: request.contextRef,
    rendererId: 'evidence-window-json-v1', tokenizerId: null, entries: described.map(entry => entry.descriptor),
    requiredExactSourceRoles: request.requiredExactSourceRoles, unresolvedRoles, continuation: request.continuation,
    cost: { renderedPackBytes: 0, fullPromptBytes: null, fullPromptTokens: null }, digest: '0'.repeat(64) };
  const window = { schemaVersion: CONTEXT_DELIVERY_VERSION, kind: 'evidence-window', manifest, bodies: described.map(entry => entry.body) };
  for (let index = 0; index < 8; index++) {
    const bytes = deliveryBytes(window); if (bytes === manifest.cost.renderedPackBytes) break; manifest.cost.renderedPackBytes = bytes;
  }
  const { digest: _digest, ...unsigned } = manifest; manifest.digest = deliveryDigest('manifest', unsigned);
  if (manifest.cost.renderedPackBytes !== deliveryBytes(window)) throw deliveryError('TargetDigestMismatch', 'Evidence-window byte accounting is inconsistent.');
  if (manifest.cost.renderedPackBytes > request.limits.reconstructedBytes) throw deliveryError('MandatoryOverflow', 'Required complete evidence window exceeds its response allowance.');
  return captureDelivery('window', window);
};

export const inspectEvidenceWindow = (input, { signal = null } = {}) => {
  const window = captureDelivery('window', input), manifest = window.manifest;
  if (window.bodies.length !== manifest.entries.length) throw deliveryError('IncompleteManifest', 'Evidence-window bodies and manifest differ.');
  const evidence = manifest.entries.map((descriptor, index) => {
    const body = window.bodies[index];
    if (body.id !== descriptor.id) throw deliveryError('IncompleteManifest', 'Evidence-window body order differs from its manifest.');
    const { id: _id, contentHash: _hash, bodyBytes: _bytes, ...metadata } = descriptor;
    return { ...metadata, text: body.text };
  });
  const rebuilt = buildEvidenceWindow({ schemaVersion: CONTEXT_DELIVERY_VERSION, contextRef: manifest.contextRef, expectedBaseDigest: null,
    requiredExactSourceRoles: manifest.requiredExactSourceRoles, unresolvedRoles: manifest.unresolvedRoles, continuation: manifest.continuation,
    limits: { packetBytes: CONTEXT_PACK_RESPONSE_MAX_BYTES, reconstructedBytes: CONTEXT_PACK_RESPONSE_MAX_BYTES } }, evidence, { signal });
  if (deliveryJson(rebuilt) !== deliveryJson(window)) throw deliveryError('TargetDigestMismatch', 'Evidence-window content, roles, qualifications, maps or digest differ.');
  return rebuilt;
};
