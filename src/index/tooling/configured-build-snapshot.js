import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const admitted = new WeakSet();
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const fail = message => Object.assign(new Error(message), { code: 'ERR_CONFIGURED_BUILD_SNAPSHOT' });
const safePath = value => typeof value === 'string' && value && !value.startsWith('/') && !value.includes('\\')
  && !value.includes(':') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

/** Read-only import of explicitly supplied CMake File API replies or normalized
 * Make target receipts. It never runs configure, make, dry-run, cquery or aquery. */
export const importConfiguredBuildSnapshot = ({ format, files, indexFile, receipt, expectedReceiptHash,
  generation, variant, expectedSourceHashes, maxFiles = 64, maxBytes = 500 * 1024, maxTargets = 1024,
  maxRelations = 4096, signal = null }) => {
  throwIfAborted(signal);
  for (const [value, maximum] of [[maxFiles, 128], [maxBytes, 2 * 1048576], [maxTargets, 4096], [maxRelations, 16384]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail('Invalid build snapshot bound.');
  }
  if (!['cmake-file-api-v1', 'make-target-receipt-v1'].includes(format) || !(files instanceof Map) || !files.size || files.size > maxFiles
    || !(expectedSourceHashes instanceof Map) || expectedSourceHashes.size > maxFiles || !receipt || receipt.schemaVersion !== 1 || receipt.format !== format
    || !digest(receipt.profileHash) || !digest(expectedReceiptHash)
    || semanticHash('tooling.configured-build-receipt.v1', receipt) !== expectedReceiptHash
    || canonicalSemanticJson(receipt.generation) !== canonicalSemanticJson(generation)
    || canonicalSemanticJson(receipt.variant) !== canonicalSemanticJson(variant)) throw fail('Build snapshot format/profile/generation/configuration receipt mismatch.');
  if (!Array.isArray(receipt.sources) || receipt.sources.length > maxFiles || !Array.isArray(receipt.files)
    || receipt.files.length > maxFiles || Buffer.byteLength(canonicalSemanticJson(receipt)) > maxBytes) throw fail('Build snapshot receipt exceeds its bound.');
  const sourceHashes = new Map();
  for (const source of receipt.sources || []) {
    if (!safePath(source.path) || !digest(source.hash) || sourceHashes.has(source.path)
      || expectedSourceHashes.get(source.path) !== source.hash) throw fail('Build snapshot source receipt is stale or conflicting.');
    sourceHashes.set(source.path, source.hash);
  }
  if (!sourceHashes.size || sourceHashes.size !== expectedSourceHashes.size) throw fail('Build snapshot source closure is incomplete.');
  const fileHashes = new Map();
  for (const file of receipt.files || []) {
    if (!safePath(file.path) || !digest(file.hash) || fileHashes.has(file.path)) throw fail('Invalid build reply identity.');
    fileHashes.set(file.path, file.hash);
  }
  if (fileHashes.size !== files.size) throw fail('Build snapshot reply inventory differs from its receipt.');
  const parsed = new Map();
  let retainedBytes = 0, relations = 0;
  for (const [filename, bytes] of files) {
    throwIfAborted(signal);
    if (!safePath(filename) || !(bytes instanceof Uint8Array) || fileHashes.get(filename) !== hash(bytes)) throw fail('Build reply bytes/path differ from the producing receipt.');
    retainedBytes += bytes.byteLength;
    if (retainedBytes > maxBytes) throw fail('Build reply byte budget exhausted.');
    try { parsed.set(filename, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { throw fail('Malformed complete JSON build reply.'); }
  }
  const targets = new Map(), unresolved = [];
  const add = target => {
    if (!target.id || typeof target.id !== 'string' || targets.has(target.id) || targets.size >= maxTargets) throw fail('Duplicate or excessive configured build target identity.');
    relations += target.dependencies.length + target.sources.length + target.outputs.length;
    if (relations > maxRelations) throw fail('Build snapshot relation budget exhausted.');
    targets.set(target.id, target);
  };
  if (format === 'make-target-receipt-v1') {
    const report = parsed.get(indexFile);
    if (report?.schemaVersion !== 1 || report.kind !== 'make-targets' || !Array.isArray(report.targets)) throw fail('Unsupported Make target receipt.');
    for (const target of report.targets) {
      if (!target || !Array.isArray(target.prerequisites) || !Array.isArray(target.outputs) || !target.source
        || sourceHashes.get(target.source.path) !== target.source.hash) throw fail('Make target lacks source receipt.');
      const dependencies = [], outputs = [];
      for (const dependency of target.prerequisites) {
        if (typeof dependency !== 'string') throw fail('Invalid Make prerequisite.');
        if (/[$%*?]/u.test(dependency)) unresolved.push({ targetId: target.name, value: dependency, reason: 'make_variable_or_pattern_unresolved' });
        else {
          if ((dependency.includes('/') || dependency.includes('\\') || /^[A-Za-z]:/u.test(dependency)) && !safePath(dependency)) throw fail('Make prerequisite escapes its explicit root.');
          dependencies.push({ id: dependency, kind: 'supplied-prerequisite', backtrace: null });
        }
      }
      for (const output of target.outputs) {
        if (!safePath(output)) throw fail('Make output escapes its explicit build mapping.');
        outputs.push(output);
      }
      add({ id: target.name, name: target.name, type: 'make-target', dependencies, outputs,
        sources: [{ path: target.source.path, generated: false }], evidence: { file: indexFile, source: target.source } });
    }
  } else {
    const index = parsed.get(indexFile);
    if (!index || !Array.isArray(index.objects)) throw fail('CMake File API reply index required.');
    const models = index.objects.filter(value => value.kind === 'codemodel' && value.version?.major === 2);
    if (models.length !== 1 || !safePath(models[0].jsonFile)) throw fail('Exactly one codemodel-v2 reply must be selected.');
    const model = parsed.get(models[0].jsonFile);
    if (!model || model.kind !== 'codemodel' || model.version?.major !== 2
      || model.paths?.source !== receipt.sourceRoot || model.paths?.build !== receipt.buildRoot
      || !Array.isArray(model.configurations)) throw fail('CMake source/build/API context mismatch.');
    const configurations = model.configurations.filter(value => value.name === variant.configuration);
    if (configurations.length !== 1 || !Array.isArray(configurations[0].targets)) throw fail('CMake configuration is missing or ambiguous.');
    const root = value => String(value || '').replaceAll('\\', '/').replace(/\/+$/u, '');
    const sourceRoot = root(receipt.sourceRoot), buildRoot = root(receipt.buildRoot), buildPrefix = receipt.buildPrefix;
    if (!sourceRoot || !buildRoot || (buildPrefix !== '' && !safePath(buildPrefix))) throw fail('Explicit contained CMake root mappings are required.');
    const mapFile = (value, base, output = false) => {
      if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw fail('Invalid CMake source/artifact path.');
      const absolute = /^(?:[A-Za-z]:\/|\/)/u.test(value) ? path.posix.normalize(value) : path.posix.normalize(base + '/' + value);
      let relative;
      if (absolute.startsWith(buildRoot + '/')) relative = [buildPrefix, absolute.slice(buildRoot.length + 1)].filter(Boolean).join('/');
      else if (!output && absolute.startsWith(sourceRoot + '/')) relative = absolute.slice(sourceRoot.length + 1);
      else throw fail('CMake path escapes the supplied source/build root mapping.');
      if (!safePath(relative)) throw fail('CMake root mapping produced an invalid relative path.');
      return relative;
    };
    for (const entry of configurations[0].targets) {
      if (!safePath(entry.jsonFile)) throw fail('CMake target reply path escapes its bundle.');
      const target = parsed.get(entry.jsonFile);
      if (!target || target.id !== entry.id || target.name !== entry.name) throw fail('CMake target reply identity mismatch.');
      if (['dependencies', 'artifacts', 'sources'].some(key => target[key] !== undefined && !Array.isArray(target[key]))) throw fail('Malformed CMake target member collection.');
      if ((target.dependencies || []).some(value => typeof value?.id !== 'string' || !value.id)) throw fail('Invalid CMake target dependency identity.');
      const dependencies = (target.dependencies || []).map(value => ({ id: value.id, kind: 'configured-build-order', backtrace: value.backtrace ?? null }));
      const outputs = (target.artifacts || []).map(value => mapFile(value.path, buildRoot, true));
      const sources = (target.sources || []).map(value => ({ path: mapFile(value.path, sourceRoot), generated: value.isGenerated === true,
        backtrace: value.backtrace ?? null }));
      for (const source of sources) if (!source.generated && !sourceHashes.has(source.path)) throw fail('CMake target source lacks producing-source authority.');
      add({ id: target.id, name: target.name, type: target.type || 'unknown', dependencies, sources, outputs,
        evidence: { file: entry.jsonFile, backtraceGraph: target.backtraceGraph || null } });
    }
    for (const target of targets.values()) for (const dependency of target.dependencies) if (!targets.has(dependency.id)) {
      unresolved.push({ targetId: target.id, value: dependency.id, reason: 'configured_target_outside_snapshot' });
    }
  }
  const metadata = freeze({ schemaVersion: 1, format, generation: structuredClone(generation), variant: structuredClone(variant),
    profileHash: receipt.profileHash, sourceHashes: [...sourceHashes].map(([path, hash]) => ({ path, hash })),
    targets: [...targets.values()], unresolved, receiptHash: expectedReceiptHash });
  const identity = semanticHash('tooling.configured-build-snapshot.v1', metadata);
  const context = Object.freeze({ schemaVersion: 1, identity, metadata,
    dependenciesFor({ targetId, sourcePath = null }) {
      const selected = targetId ? [targets.get(targetId)].filter(Boolean) : [...targets.values()].filter(target => target.sources.some(source => source.path === sourcePath));
      return selected.map(target => ({ targetId: target.id, dependencies: structuredClone(target.dependencies),
        sourceIdentity: [...sourceHashes].map(([path, hash]) => ({ path, hash })), generation: structuredClone(metadata.generation),
        variant: structuredClone(metadata.variant), snapshotHash: identity, provenance: 'configured-build-snapshot' }));
    } });
  admitted.add(context); return context;
};

export const assertConfiguredBuildSnapshot = snapshot => {
  if (!admitted.has(snapshot)) throw fail('Configured build context must come from admitted snapshot import.');
  return snapshot;
};
