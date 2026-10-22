import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseJsoncStructure } from '../../shared/jsonc-structure.js';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const require = createRequire(import.meta.url);
const parserVersion = require('jsonc-parser/package.json').version;
const escapePointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const decodePointer = value => {
  if (value === '') return '';
  if (!value.startsWith('/') || /~(?![01])/u.test(value)) return null;
  return value.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
};
const fail = message => Object.assign(new Error(message), { code: 'ERR_CONFIG_EVIDENCE_BOUNDARY' });
const safePath = value => typeof value === 'string' && value && !value.startsWith('/') && !value.includes('\\')
  && !value.includes(':') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');

/** Offline JSON/JSONC document-path and local-reference evidence. No schema,
 * addon, network resource or unadmitted file is discovered or executed. */
export const collectJsonReferenceEvidence = ({ documents, maxDocuments = 20, maxSourceBytes = 500 * 1024,
  maxNodes = 16384, maxReferences = 256, maxDepth = 16, maxMs = 30, signal = null }) => {
  if (!(documents instanceof Map) || !Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 20
    || documents.size > maxDocuments || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 16384
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid offline configuration evidence bounds.');
  const vendor = require('jsonc-parser'), startedAt = performance.now(), parsed = new Map();
  let sourceBytes = 0, nodeCount = 0, referenceCount = 0;
  const check = () => { throwIfAborted(signal); if (performance.now() - startedAt >= maxMs) throw fail('Configuration evidence time budget exhausted.'); };
  for (const [filename, item] of documents) {
    check();
    if (!safePath(filename) || !item?.source || item.source.path !== filename || typeof item.text !== 'string'
      || createHash('sha256').update(item.text).digest('hex') !== item.source.byteHash) throw fail('Configuration document differs from its original source snapshot.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('Configuration source byte budget exhausted.');
    const dialect = path.posix.extname(filename).toLowerCase() === '.jsonc' ? 'jsonc' : 'json';
    const admission = parseJsoncStructure(item.text, { remainingMs: () => maxMs - (performance.now() - startedAt) });
    const result = { item, dialect, paths: new Map(), references: [], diagnostics: [], status: 'partial', root: null };
    parsed.set(filename, result);
    if (admission.reason) { result.diagnostics.push({ code: 'parser_unavailable', reason: admission.reason, span: null }); continue; }
    const errors = [];
    const root = vendor.parseTree(item.text, errors, { disallowComments: dialect === 'json', allowTrailingComma: dialect === 'jsonc', allowEmptyContent: false });
    check();
    if (errors.length || !root) {
      for (const error of errors.slice(0, 64)) result.diagnostics.push({ code: 'syntax_error', parserCode: error.error,
        span: [error.offset, error.offset + error.length] });
      continue;
    }
    result.root = root;
    const pending = [{ node: root, pointer: '', keySpan: null }];
    while (pending.length) {
      check();
      if (++nodeCount > maxNodes) throw fail('Configuration document-path node budget exhausted.');
      const { node, pointer, keySpan } = pending.pop();
      const span = [node.offset, node.offset + node.length];
      if (span.some(value => !Number.isSafeInteger(value) || value < 0) || span[1] > item.text.length) throw fail('Invalid configuration parser span.');
      const entries = result.paths.get(pointer) || [];
      entries.push({ pointer, span, keySpan, valueKind: node.type }); result.paths.set(pointer, entries);
      if (entries.length > 1) result.diagnostics.push({ code: 'duplicate_document_path', pointer, span: keySpan || span });
      if (node.type === 'object') {
        for (const property of node.children || []) {
          const [key, value] = property.children || [];
          if (!key || typeof key.value !== 'string' || !value) throw fail('Unsupported configuration property node.');
          const childPointer = pointer + '/' + escapePointer(key.value);
          pending.push({ node: value, pointer: childPointer, keySpan: [key.offset, key.offset + key.length] });
          if (['$ref', '$dynamicRef'].includes(key.value) && value.type === 'string') {
            if (++referenceCount > maxReferences) throw fail('Configuration reference budget exhausted.');
            result.references.push({ pointer, value: value.value, span: [value.offset, value.offset + value.length],
              referenceKind: key.value, status: 'unresolved', reason: null, target: null });
          }
        }
      } else if (node.type === 'array') {
        for (let index = (node.children || []).length - 1; index >= 0; index--) pending.push({ node: node.children[index],
          pointer: pointer + '/' + index, keySpan: null });
      }
    }
  }
  const locate = (filename, reference) => {
    if (reference.referenceKind !== '$ref') return { reason: 'dynamic_reference_unsupported' };
    if (typeof reference.value !== 'string' || reference.value.includes('\0') || reference.value.includes('\\')) return { reason: 'invalid_reference' };
    const hash = reference.value.indexOf('#'), filePart = hash < 0 ? reference.value : reference.value.slice(0, hash);
    let fragment, decodedFile;
    try { fragment = hash < 0 ? '' : decodeURIComponent(reference.value.slice(hash + 1)); decodedFile = decodeURIComponent(filePart); } catch { return { reason: 'invalid_uri_encoding' }; }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(decodedFile) || decodedFile.startsWith('/')) return { reason: 'remote_or_absolute_reference_denied' };
    const targetPath = decodedFile ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), decodedFile)) : filename;
    if (!safePath(targetPath)) return { reason: 'reference_path_escape' };
    const tokens = decodePointer(fragment);
    if (tokens === null) return { reason: 'named_anchor_or_invalid_pointer_unsupported' };
    const pointer = tokens === '' ? '' : '/' + tokens.map(escapePointer).join('/');
    const document = parsed.get(targetPath);
    if (!document?.root) return { reason: 'admitted_document_unavailable' };
    if (Array.isArray(tokens)) for (let depth = 1; depth <= tokens.length; depth++) {
      const ancestor = '/' + tokens.slice(0, depth).map(escapePointer).join('/');
      if ((document.paths.get(ancestor) || []).length > 1) return { reason: 'ambiguous_duplicate_key' };
    }
    const targets = document.paths.get(pointer) || [];
    if (targets.length !== 1) return { reason: targets.length ? 'ambiguous_duplicate_key' : 'pointer_target_missing' };
    return { document, target: { path: targetPath, pointer, span: targets[0].span,
      sourceUnitId: document.item.source.sourceUnitId, sourceHash: document.item.source.byteHash } };
  };
  for (const [filename, document] of parsed) for (const reference of document.references) {
    check();
    let currentFile = filename, current = reference, resolved = null;
    const visited = new Set();
    for (let depth = 0; depth < maxDepth; depth++) {
      check();
      const key = currentFile + '#' + current.pointer;
      if (visited.has(key)) { resolved = { reason: 'local_reference_cycle' }; break; }
      visited.add(key);
      resolved = locate(currentFile, current);
      if (!resolved.target) break;
      const next = resolved.document.references.filter(value => value.pointer === resolved.target.pointer);
      if (next.length !== 1) break;
      currentFile = resolved.target.path; current = next[0];
      if (depth === maxDepth - 1) resolved = { reason: 'reference_depth_budget' };
    }
    reference.target = resolved?.target || null;
    reference.reason = resolved?.reason || null;
    reference.status = reference.target ? 'resolved' : 'unresolved';
  }
  const results = [...parsed].map(([filename, document]) => ({ schemaVersion: 1, kind: 'structured-config-evidence',
    sourceUnitId: document.item.source.sourceUnitId, sourceHash: document.item.source.byteHash, path: filename,
    dialect: document.dialect, parser: { family: 'jsonc-parser', version: parserVersion },
    state: 'partial', reason: 'schema_validation_not_requested',
    paths: [...document.paths.values()].flat().sort((a, b) => a.span[0] - b.span[0]),
    references: document.references.sort((a, b) => a.span[0] - b.span[0]), diagnostics: document.diagnostics,
    schemaIdentity: null, networkAllowed: false }));
  const identity = semanticHash('tooling.offline-config-evidence.v1', results);
  canonicalSemanticJson(results);
  return { schemaVersion: 1, identity, results, metrics: { sourceBytes, nodeCount, referenceCount } };
};

/** Adapt the local-reference subset to the common canonical evidence writer.
 * Paths remain syntax facts; schema validation and dynamic anchors stay unknown. */
export const createJsonReferenceEvidenceReport = ({ evidence, generation, configHash, dependencyHash, profileHash = null }) => {
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  canonicalSemanticJson(evidence);
  if (evidence?.schemaVersion !== 1 || !Array.isArray(evidence.results) || !evidence.results.length
    || evidence.results.length > 20 || semanticHash('tooling.offline-config-evidence.v1', evidence.results) !== evidence.identity
    || !generation || !digest(configHash) || !digest(dependencyHash) || (profileHash !== null && !digest(profileHash))) throw fail('Invalid configuration evidence report identity.');
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'configuration-local-references', adapterVersion: '1',
    method: 'configuration/local-references', evidenceKind: 'configuration-local-references', generation: structuredClone(generation),
    runtime: { family: 'jsonc-parser', version: parserVersion, profileHash, qualification: 'application-library-unqualified' },
    project: { configHash, dependencyHash },
    results: evidence.results.map(result => ({ path: result.path, sourceUnitId: result.sourceUnitId, sourceHash: result.sourceHash,
      state: 'partial', reason: result.reason, dialect: result.dialect, diagnostics: result.diagnostics.slice(0, 32),
      omittedDiagnostics: Math.max(0, result.diagnostics.length - 32),
      references: result.references.map(reference => ({ ...reference, family: 'jsonPointer', state: reference.status })) })),
    coverage: { localReferences: true, schemaValidation: false, networkAllowed: false }, metrics: structuredClone(evidence.metrics) };
  return { ...report, identity: semanticHash('tooling.source-linked-evidence.v1', report) };
};
