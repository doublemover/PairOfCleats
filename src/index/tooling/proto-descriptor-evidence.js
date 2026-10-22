import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { finalizeSourceLinkedReport } from './source-linked-report.js';
import { captureSourceLinkedInput } from './source-linked-input.js';

const require = createRequire(import.meta.url);
const fail = message => Object.assign(new Error(message), { code: 'ERR_PROTO_DESCRIPTOR_EVIDENCE' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const safePath = value => typeof value === 'string' && value && value.length <= 4096 && !/[\\:\x00-\x1f]/u.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const name = value => typeof value === 'string' && value.length <= 256 && /^[A-Za-z_][A-Za-z_0-9]*$/u.test(value);
const same = (left, right) => canonicalSemanticJson(left, { maxBytes: 1024 * 1024 }) === canonicalSemanticJson(right, { maxBytes: 1024 * 1024 });

export const PROTO_DESCRIPTOR_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'proto-descriptor-import', adapterVersion: '3', execution: 'report',
  languages: [{ id: 'proto', dialect: null }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'symbols', evidence: 'provider-observation' },
    { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'symbols', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'observed-tool', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 1024 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Protoc columns count UTF-8 bytes with tab stops of eight, not LSP UTF-16.
 * Build only code-point boundaries and reject columns inside a tab/code point. */
const sourceLocations = (text, check) => {
  const lines = [{ columns: [0], offsets: [0] }];
  let offset = 0, column = 0;
  for (const character of text) {
    check();
    offset += character.length;
    if (character === '\n') { column = 0; lines.push({ columns: [0], offsets: [offset] }); }
    else {
      column = character === '\t' ? column + 8 - column % 8 : column + Buffer.byteLength(character);
      lines.at(-1).columns.push(column); lines.at(-1).offsets.push(offset);
    }
  }
  const point = (line, wanted) => {
    const entry = lines[line];
    if (!entry) return null;
    let low = 0, high = entry.columns.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1, column = entry.columns[mid];
      if (column === wanted) return entry.offsets[mid];
      if (column < wanted) low = mid + 1; else high = mid - 1;
    }
    return null;
  };
  return span => {
    if (!Array.isArray(span) || ![3, 4].includes(span.length) || span.some(value => !Number.isSafeInteger(value) || value < 0)) return null;
    const start = point(span[0], span[1]), end = point(span.length === 3 ? span[0] : span[2], span.at(-1));
    return start === null || end === null || end < start ? null : [start, end];
  };
};

/** Import a complete bounded binary FileDescriptorSet and independently pinned
 * producing receipt. No protoc/Buf invocation, include loading or network occurs.
 * Unknown custom-option bytes are retained in the original artifact, not decoded
 * into invented extension semantics. */
export const prepareProtoDescriptorEvidence = ({ bytes, producingReceipt, expectedReceiptHash, generation, documents,
  maxDescriptorBytes = 256 * 1024, maxSourceBytes = 500 * 1024, maxSymbols = 4096, maxLocations = 8192,
  maxReferences = 4096, maxDepth = 64, maxMs = 1000, signal = null }) => {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxDescriptorBytes) || maxDescriptorBytes < 1 || maxDescriptorBytes > 256 * 1024
    || bytes.byteLength > maxDescriptorBytes || !(documents instanceof Map) || !documents.size || documents.size > 20
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxSymbols) || maxSymbols < 1 || maxSymbols > 4096
    || !Number.isSafeInteger(maxLocations) || maxLocations < 1 || maxLocations > 8192
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid Proto descriptor input or bounds.');
  const started = performance.now();
  const checkTime = () => { if (performance.now() - started >= maxMs) throw fail('Proto descriptor time budget exhausted.'); };
  const check = () => { throwIfAborted(signal); checkTime(); };
  checkTime();
  bytes = Buffer.from(bytes);
  const artifactHash = createHash('sha256').update(bytes).digest('hex');
  if (!producingReceipt || !digest(expectedReceiptHash)) { check(); return { status: 'non-authoritative', reason: 'producing_source_receipt_unavailable', artifactHash, report: null }; }
  const admission = { maxBytes: PROTO_DESCRIPTOR_PROVIDER_DECLARATION.limits.maxBytes, fail, check: checkTime,
    message: 'Proto producing receipt/context byte budget exhausted.' };
  const captured = captureSourceLinkedInput(producingReceipt, { ...admission, domain: 'tooling.proto-descriptor-producing-receipt.v1' });
  producingReceipt = captured.value;
  generation = captureSourceLinkedInput(generation, admission).value;
  check();
  if (producingReceipt.schemaVersion !== 1 || captured.identity !== expectedReceiptHash
    || producingReceipt.artifactHash !== artifactHash || !same(producingReceipt.generation, generation)
    || !digest(producingReceipt.profileHash) || !digest(producingReceipt.configHash) || !digest(producingReceipt.dependencyHash)
    || !digest(producingReceipt.dependencyLockHash) || !digest(producingReceipt.customOptionIdentity)
    || producingReceipt.columnEncoding !== 'protoc-byte-tab8-v1'
    || !Array.isArray(producingReceipt.includeRoots) || !producingReceipt.includeRoots.length || producingReceipt.includeRoots.length > 20
    || producingReceipt.includeRoots.some(value => typeof value !== 'string' || !value || value.length > 4096)
    || !['protoc', 'buf-protocompile'].includes(producingReceipt.tool?.family)
    || typeof producingReceipt.tool.version !== 'string' || !producingReceipt.tool.version || producingReceipt.tool.version.length > 256
    || !Array.isArray(producingReceipt.sources) || producingReceipt.sources.length !== documents.size) throw fail('Proto artifact/tool/project/dependency/generation receipt mismatch.');
  const version = require('protobufjs/package.json').version;
  if (version !== '8.8.0') throw fail('Proto decoder version is not qualified by this adapter.');
  const protobuf = require('protobufjs/light'), descriptor = require('protobufjs/ext/descriptor');
  if (!Number.isSafeInteger(protobuf.Reader.recursionLimit) || protobuf.Reader.recursionLimit < 1 || protobuf.Reader.recursionLimit > 100) throw fail('Proto decoder recursion bound is not admitted.');
  let decoded, set;
  try {
    const reader = protobuf.Reader.create(bytes); reader.discardUnknown = false;
    decoded = descriptor.FileDescriptorSet.decode(reader);
    if (reader.pos !== bytes.length) throw fail('Proto descriptor did not consume the complete artifact.');
    set = descriptor.FileDescriptorSet.toObject(decoded, { longs: String, bytes: String, defaults: false, arrays: true });
  } catch (error) { if (error.code === 'ERR_PROTO_DESCRIPTOR_EVIDENCE') throw error; throw fail('Malformed or unsupported binary Proto descriptor set.'); }
  check();
  if (!Array.isArray(set.file) || !set.file.length || set.file.length > 20) throw fail('Proto descriptor file count exceeds its bound.');
  const receiptSources = new Map(), sourceIds = new Set(), results = new Map();
  let sourceBytes = 0, locationCount = 0, symbolCount = 0, referenceCount = 0;
  for (const receipt of producingReceipt.sources) {
    check();
    const item = documents.get(receipt.sourcePath);
    if (!safePath(receipt.descriptorPath) || receiptSources.has(receipt.descriptorPath) || !safePath(receipt.sourcePath)
      || !item || item.source.path !== receipt.sourcePath || receipt.sourceUnitId !== item.source.sourceUnitId
      || receipt.byteHash !== item.source.byteHash || sourceIds.has(receipt.sourceUnitId)
      || receipt.syntaxPartitionId !== item.syntax?.partitionId || receipt.syntaxHash !== item.syntax?.canonicalHash
      || receipt.mappingIdentity !== (item.source.mapping?.identity ?? null)
      || typeof item.text !== 'string' || createHash('sha256').update(item.text).digest('hex') !== receipt.byteHash
      || !same(item.facts.storage.generation, generation)) throw fail('Proto descriptor source differs from its producing parser snapshot.');
    if (item.source.mapping && item.source.mapping.quality !== 'exact') throw fail('Proto source mapping is not exact.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('Proto source byte budget exhausted.');
    receiptSources.set(receipt.descriptorPath, { receipt, item, range: sourceLocations(item.text, check) }); sourceIds.add(receipt.sourceUnitId);
    results.set(receipt.descriptorPath, { path: item.source.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      state: 'partial', reason: 'descriptor_features_and_runtime_unqualified', references: [], diagnostics: [], declarations: [] });
  }
  const files = new Map(), symbols = new Map(), symbolEntries = [];
  for (const file of set.file) {
    check();
    if (!safePath(file.name) || files.has(file.name) || (file.package && !file.package.split('.').every(name))) throw fail('Invalid or duplicate Proto descriptor file/package identity.');
    const source = receiptSources.get(file.name), locations = new Map();
    for (const location of file.sourceCodeInfo?.location || []) {
      if (++locationCount > maxLocations || !Array.isArray(location.path) || location.path.length > 128
        || location.path.some(value => !Number.isSafeInteger(value) || value < 0)) throw fail('Invalid Proto SourceCodeInfo path or location budget.');
      const key = location.path.join('.');
      if (locations.has(key) && !same(locations.get(key), location.span)) throw fail('Conflicting Proto source locations.');
      locations.set(key, location.span);
    }
    const syntax = file.syntax || 'proto2', supported = ['proto2', 'proto3'].includes(syntax) && !Object.hasOwn(file, 'edition');
    if ((file.dependency || []).length > 20 || new Set(file.dependency || []).size !== (file.dependency || []).length) throw fail('Proto import inventory exceeds its bounded unique file closure.');
    const info = { file, source, locations, supported, syntax };
    files.set(file.name, info);
    const result = results.get(file.name);
    if (result) {
      result.syntax = syntax; result.edition = file.edition ?? null;
      result.options = file.options || null;
      if (!supported) { result.reason = 'unsupported_edition'; result.diagnostics.push({ code: 'unsupported_edition', edition: file.edition ?? null, span: null }); }
    }
  }
  for (const descriptorPath of receiptSources.keys()) if (!files.has(descriptorPath)) throw fail('Producing source receipt is absent from the descriptor artifact.');
  const locate = (info, descriptorPath) => {
    if (!info.source || !info.supported) return null;
    const span = info.source.range(info.locations.get(descriptorPath.join('.')));
    if (!span) return null;
    const { source } = info.source.item;
    return { path: source.path, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, span };
  };
  const addSymbol = (info, node, scope, descriptorPath, family, depth) => {
    if (++symbolCount > maxSymbols || depth > maxDepth || !name(node.name)) throw fail('Invalid Proto symbol or symbol/depth budget.');
    const qualifiedName = scope + '.' + node.name;
    if (symbols.has(qualifiedName)) throw fail('Duplicate fully qualified Proto descriptor name.');
    const entry = { info, node, descriptorPath, family, qualifiedName,
      target: locate(info, [...descriptorPath, 1]), span: locate(info, descriptorPath)?.span || null };
    if (entry.target && info.source.item.text.slice(...entry.target.span) !== node.name) {
      entry.target = null;
      const result = results.get(info.file.name);
      if (result && result.diagnostics.length < 32) result.diagnostics.push({ code: 'declaration_source_text_mismatch', qualifiedName, span: entry.span });
    }
    if (family === 'enum') for (const value of node.value || []) {
      if (++symbolCount > maxSymbols || !name(value.name) || !Number.isSafeInteger(value.number)) throw fail('Invalid Proto enum value or symbol budget.');
    }
    symbols.set(qualifiedName, entry); symbolEntries.push(entry);
    const result = results.get(info.file.name);
    if (result) result.declarations.push({ family, qualifiedName, name: node.name, span: entry.span,
      target: entry.target, number: node.number ?? null, typeCode: node.type ?? null, label: node.label ?? null,
      options: node.options || null, clientStreaming: node.clientStreaming ?? false, serverStreaming: node.serverStreaming ?? false,
      enumValues: family === 'enum' ? (node.value || []).map(value => ({ name: value.name, number: value.number, options: value.options || null })) : [] });
    return entry;
  };
  for (const info of files.values()) {
    const scope = info.file.package ? '.' + info.file.package : '';
    const pending = [];
    for (const [index, node] of (info.file.messageType || []).entries()) {
      pending.push({ node, scope, path: [4, index], depth: 0 });
      if (pending.length > maxSymbols) throw fail('Proto pending symbol budget exhausted.');
    }
    while (pending.length) {
      check();
      const current = pending.pop(), entry = addSymbol(info, current.node, current.scope, current.path, 'message', current.depth);
      for (const [index, node] of (current.node.field || []).entries()) {
        if (!Number.isSafeInteger(node.number) || node.number < 1 || node.number > 536870911) throw fail('Invalid Proto field number.');
        addSymbol(info, node, entry.qualifiedName, [...current.path, 2, index], 'field', current.depth + 1);
      }
      for (const [index, node] of (current.node.enumType || []).entries()) addSymbol(info, node, entry.qualifiedName, [...current.path, 4, index], 'enum', current.depth + 1);
      for (const [index, node] of (current.node.nestedType || []).entries()) {
        pending.push({ node, scope: entry.qualifiedName, path: [...current.path, 3, index], depth: current.depth + 1 });
        if (pending.length > maxSymbols) throw fail('Proto pending symbol budget exhausted.');
      }
    }
    for (const [index, node] of (info.file.enumType || []).entries()) addSymbol(info, node, scope, [5, index], 'enum', 0);
    for (const [index, node] of (info.file.service || []).entries()) {
      const service = addSymbol(info, node, scope, [6, index], 'service', 0);
      for (const [methodIndex, method] of (node.method || []).entries()) addSymbol(info, method, service.qualifiedName, [6, index, 2, methodIndex], 'method', 1);
    }
  }
  const visible = new Map();
  for (const info of files.values()) {
    check();
    const allowed = new Set([info.file.name]), imports = info.file.dependency || [], result = results.get(info.file.name);
    for (const index of [...(info.file.publicDependency || []), ...(info.file.weakDependency || [])]) if (!Number.isSafeInteger(index) || index < 0 || index >= imports.length) throw fail('Invalid Proto dependency visibility index.');
    for (const [index, dependency] of imports.entries()) {
      if (!safePath(dependency)) throw fail('Proto import escapes its descriptor include mapping.');
      const dependencyInfo = files.get(dependency), targetItem = dependencyInfo?.source?.item;
      const from = locate(info, [3, index]);
      if (result && from) {
        if (++referenceCount > maxReferences) throw fail('Proto reference budget exhausted.');
        result.references.push({ family: 'protoImport', name: dependency, span: from.span,
          target: targetItem && dependencyInfo.supported ? { path: targetItem.source.path, sourceUnitId: targetItem.source.sourceUnitId,
            sourceHash: targetItem.source.byteHash, span: [0, targetItem.text.length] } : null,
          state: targetItem && dependencyInfo.supported ? 'resolved' : 'unresolved', reason: targetItem && dependencyInfo.supported ? null : 'import_source_unavailable' });
      }
      if (!dependencyInfo && result && result.diagnostics.length < 32) result.diagnostics.push({ code: 'unresolved_import', path: dependency, span: from?.span || null });
      const pending = [{ path: dependency, chain: [info.file.name] }], visited = new Set();
      while (pending.length) {
        check();
        const current = pending.pop();
        if (current.chain.includes(current.path)) {
          if (result && result.diagnostics.length < 32) result.diagnostics.push({ code: 'import_cycle', path: current.path, span: null });
          continue;
        }
        if (visited.has(current.path)) continue; visited.add(current.path); allowed.add(current.path);
        const file = files.get(current.path)?.file;
        if (!file) continue;
        for (const publicIndex of file.publicDependency || []) {
          const next = file.dependency?.[publicIndex];
          if (typeof next === 'string') pending.push({ path: next, chain: [...current.chain, current.path] });
        }
      }
    }
    visible.set(info.file.name, allowed);
    if (result) {
      const pending = [{ path: info.file.name, chain: [] }], visited = new Set();
      while (pending.length) {
        check();
        const current = pending.pop();
        if (current.chain.includes(current.path)) {
          if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'import_cycle', path: current.path, span: null });
          continue;
        }
        if (visited.has(current.path)) continue; visited.add(current.path);
        for (const dependency of files.get(current.path)?.file.dependency || []) pending.push({ path: dependency,
          chain: [...current.chain, current.path] });
      }
    }
  }
  for (const entry of symbolEntries) {
    check();
    const result = results.get(entry.info.file.name);
    if (!result || !entry.info.supported) continue;
    const requests = entry.family === 'field' ? [[6, entry.node.typeName, 'protoFieldType'], [2, entry.node.extendee, 'protoExtendee']]
      : entry.family === 'method' ? [[2, entry.node.inputType, 'protoMethodInput'], [3, entry.node.outputType, 'protoMethodOutput']] : [];
    for (const [field, qualifiedName, family] of requests) {
      if (!qualifiedName) continue;
      if (typeof qualifiedName !== 'string' || qualifiedName.length > 4096) throw fail('Proto qualified type name exceeds its bound.');
      const from = locate(entry.info, [...entry.descriptorPath, field]);
      if (!from) { if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'reference_source_info_unavailable', qualifiedName, span: null }); continue; }
      if (++referenceCount > maxReferences) throw fail('Proto reference budget exhausted.');
      const candidate = qualifiedName.startsWith('.') ? symbols.get(qualifiedName) : null;
      const admitted = candidate && visible.get(entry.info.file.name).has(candidate.info.file.name)
        && ['message', 'enum'].includes(candidate.family);
      const target = admitted ? candidate.target : null;
      result.references.push({ family, name: qualifiedName, span: from.span, target,
        state: target ? 'resolved' : 'unresolved', reason: target ? null : !qualifiedName.startsWith('.') ? 'unlinked_relative_type_name'
          : candidate && !admitted ? 'type_not_visible_through_imports' : 'descriptor_target_source_unavailable' });
    }
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'proto-descriptor-import', adapterVersion: '3',
    method: 'proto/descriptor-set', evidenceKind: 'proto-descriptor-references', generation,
    runtime: { family: 'protobufjs-descriptor', version, profileHash: producingReceipt.profileHash, qualification: 'application-library-unqualified' },
    project: { configHash: producingReceipt.configHash, dependencyHash: producingReceipt.dependencyHash,
      dependencyLockHash: producingReceipt.dependencyLockHash, customOptionIdentity: producingReceipt.customOptionIdentity },
    producingTool: producingReceipt.tool, producingReceiptHash: expectedReceiptHash, includeRoots: producingReceipt.includeRoots,
    descriptorArtifact: { hash: artifactHash, bytes: bytes.length, base64: bytes.toString('base64'),
      columnEncoding: producingReceipt.columnEncoding, unknownFields: 'retained-original-wire-only' },
    externalDescriptorFiles: [...files.values()].filter(info => !info.source).map(info => ({ path: info.file.name, syntax: info.syntax, edition: info.file.edition ?? null })),
    results: [...results.values()], coverage: { sourceInfo: [...files.values()].every(info => !info.source || info.locations.size > 0),
      descriptorSetSupplied: true, completeImportClosure: [...files.values()].every(info => (info.file.dependency || []).every(value => files.has(value))), customOptionsInterpreted: false,
      generatedRuntimeCallFlow: false, editionsQualified: false }, metrics: { sourceBytes, symbolCount, locationCount, referenceCount } };
  check();
  return { status: 'partial', reason: 'descriptor_features_and_runtime_unqualified', artifactHash,
    report: finalizeSourceLinkedReport(report, { maxBytes: PROTO_DESCRIPTOR_PROVIDER_DECLARATION.limits.maxBytes,
      fail, message: 'Proto descriptor output byte budget exhausted.', check }) };
};
