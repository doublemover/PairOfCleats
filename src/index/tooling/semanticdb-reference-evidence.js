import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { exactLspRange } from '../semantic/lsp-locations.js';
import { decodeSemanticdbEvidenceWire } from './semanticdb-wire.js';
import { throwIfAborted } from '../../shared/abort.js';
import { finalizeSourceLinkedReport } from './source-linked-report.js';
import { captureSourceLinkedInput } from './source-linked-input.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTICDB_EVIDENCE' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (a, b) => canonicalSemanticJson(a, { maxBytes: 1024 * 1024 }) === canonicalSemanticJson(b, { maxBytes: 1024 * 1024 });
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f]/u.test(value);
const safePath = value => label(value) && !/[\\:]/u.test(value) && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');

export const SEMANTICDB_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'scala-semanticdb-import', adapterVersion: '3', execution: 'report',
  languages: [{ id: 'scala', dialect: null }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'symbols', evidence: 'provider-observation' },
    { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'symbols', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'observed-tool', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 1024 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Offline SemanticDB4 evidence, with independent original producing authority.
 * No Scala compiler, build server, Metals, module loader or build refresh runs.
 * Existing parser partitions remain the sole source/syntax admission owner. */
export const prepareSemanticdbReferenceEvidence = ({ bytes, producingReceipt, expectedReceiptHash, generation, documents,
  maxArtifactBytes = 256 * 1024, maxSourceBytes = 500 * 1024, maxReferences = 4096,
  maxNodes = 32768, maxDepth = 32, maxMs = 1000, signal = null }) => {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1 || maxArtifactBytes > 256 * 1024
    || bytes.byteLength > maxArtifactBytes || !generation || !(documents instanceof Map) || !documents.size || documents.size > 20
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 32768
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 32
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid SemanticDB import inputs or bounds.');
  const started = performance.now();
  const checkTime = () => { if (performance.now() - started >= maxMs) throw fail('SemanticDB import time budget exhausted.'); };
  const check = () => { throwIfAborted(signal); checkTime(); };
  checkTime();
  bytes = Buffer.from(bytes);
  const artifactHash = createHash('sha256').update(bytes).digest('hex');
  if (!producingReceipt || !digest(expectedReceiptHash)) { check(); return { status: 'non-authoritative',
    reason: 'producing_source_receipt_unavailable', artifactHash, report: null }; }
  const admission = { maxBytes: SEMANTICDB_PROVIDER_DECLARATION.limits.maxBytes, fail, check: checkTime,
    message: 'SemanticDB producing receipt/context byte budget exhausted.' };
  const { value: receipt, identity: receiptHash } = captureSourceLinkedInput(producingReceipt,
    { ...admission, domain: 'tooling.semanticdb-producing-receipt.v1' });
  generation = captureSourceLinkedInput(generation, admission).value;
  check();
  if (receipt.schemaVersion !== 1 || receiptHash !== expectedReceiptHash
    || receipt.artifactHash !== artifactHash || !same(receipt.generation, generation)
    || !digest(receipt.profileHash) || !digest(receipt.configHash) || !digest(receipt.dependencyHash)
    || !digest(receipt.classpathHash) || !label(receipt.buildTarget) || !label(receipt.targetPlatform)
    || !['semanticdb-scalac', 'scala3-semanticdb'].includes(receipt.tool?.family)
    || !label(receipt.tool.version) || !label(receipt.tool.compilerVersion)
    || receipt.positionEncoding !== 'utf-16' || !Array.isArray(receipt.sources)
    || receipt.sources.length !== documents.size) throw fail('SemanticDB artifact/compiler/project/build-target receipt mismatch.');
  const sources = new Map(), results = new Map(), sourceIds = new Set();
  let sourceBytes = 0, namespace = null, referenceCount = 0;
  for (const entry of receipt.sources) {
    check();
    const item = documents.get(entry.sourcePath), source = item?.source;
    if (!safePath(entry.sourcePath) || !safePath(entry.documentPath) || sources.has(entry.documentPath)
      || !source || source.path !== entry.sourcePath || source.language !== 'scala'
      || source.sourceUnitId !== entry.sourceUnitId || source.byteHash !== entry.byteHash || sourceIds.has(source.sourceUnitId)
      || entry.syntaxPartitionId !== item.syntax?.partitionId || entry.syntaxHash !== item.syntax?.canonicalHash
      || entry.mappingIdentity !== (source.mapping?.identity ?? null)
      || typeof item.text !== 'string' || createHash('sha256').update(item.text).digest('hex') !== source.byteHash
      || !same(item.facts?.storage?.generation, generation)
      || (namespace !== null && source.repositoryNamespace !== namespace)
      || (source.mapping && source.mapping.quality !== 'exact')) throw fail('SemanticDB source differs from the original parser snapshot.');
    namespace = source.repositoryNamespace;
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('SemanticDB source byte budget exhausted.');
    sources.set(entry.documentPath, item); sourceIds.add(source.sourceUnitId);
    results.set(entry.documentPath, { path: source.path, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      state: 'partial', reason: 'compiler_semanticdb_subset_unqualified', references: [], diagnostics: [],
      symbols: [], occurrences: [], synthetics: [] });
  }
  const decoded = decodeSemanticdbEvidenceWire({ bytes, check, maxNodes, maxDepth });
  if (!decoded.value.documents?.length || decoded.value.documents.length !== sources.size) throw fail('SemanticDB document closure differs from the producing receipt.');
  const seen = new Set(), definitions = new Map(), pending = [];
  const symbolKey = (symbol, filename) => receipt.buildTarget + '\0' + (/^local[0-9]+(?:\+[0-9]+)?$/u.test(symbol) ? filename + '\0' : '') + symbol;
  const spanAt = (item, range) => {
    if (!range) return null;
    const span = exactLspRange(item.source, item.text, { start: { line: range.startLine ?? 0, character: range.startCharacter ?? 0 },
      end: { line: range.endLine ?? 0, character: range.endCharacter ?? 0 } }, 'utf-16');
    return span && !span.some(offset => offset > 0 && offset < item.text.length
      && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])) ? span : null;
  };
  const witness = (item, span) => ({ path: item.source.path, sourceUnitId: item.source.sourceUnitId,
    sourceHash: item.source.byteHash, span });
  for (const document of decoded.value.documents) {
    check();
    let filename;
    try { filename = decodeURIComponent(document.uri || ''); } catch { throw fail('Invalid percent-encoded SemanticDB document URI.'); }
    if (!safePath(filename) || !sources.has(filename) || seen.has(filename)) throw fail('SemanticDB document URI is missing, duplicated or outside its source closure.');
    seen.add(filename);
    const item = sources.get(filename), result = results.get(filename);
    if (document.schema !== 4 || document.language !== 1) throw fail('Only Scala SemanticDB4 documents are admitted by this adapter.');
    if (document.buildTarget && document.buildTarget !== receipt.buildTarget) throw fail('SemanticDB document belongs to another build target.');
    result.buildTargetEvidence = document.buildTarget ? 'document-and-producing-receipt' : 'producing-receipt-only';
    if (document.text && document.text !== item.text) throw fail('SemanticDB retained text is stale.');
    if (document.md5 && (!/^[a-fA-F0-9]{32}$/u.test(document.md5)
      || createHash('md5').update(item.text).digest('hex') !== document.md5.toLowerCase())) throw fail('SemanticDB source fingerprint is stale.');
    const symbolIds = new Set();
    for (const symbol of document.symbols || []) {
      check();
      if (!label(symbol.symbol) || symbolIds.has(symbol.symbol) || (symbol.displayName || '').length > 4096
        || (symbol.overriddenSymbols || []).some(value => !label(value))) throw fail('Invalid or duplicate SemanticDB symbol metadata.');
      symbolIds.add(symbol.symbol);
      result.symbols.push({ ...symbol, signatureInterpretation: 'opaque-wire-retained',
        scope: /^local[0-9]+(?:\+[0-9]+)?$/u.test(symbol.symbol) ? 'document-local' : 'build-target-global' });
    }
    for (const occurrence of document.occurrences || []) {
      check();
      if (!label(occurrence.symbol) || ![0, 1, 2].includes(occurrence.role ?? 0)) throw fail('Invalid SemanticDB occurrence symbol/role.');
      const span = spanAt(item, occurrence.range);
      const observed = { symbol: occurrence.symbol, role: occurrence.role ?? 0, span,
        state: span ? 'source-qualified' : 'unmapped', range: occurrence.range || null };
      result.occurrences.push(observed);
      if (!span) continue;
      if (occurrence.role === 2) {
        const key = symbolKey(occurrence.symbol, filename), candidates = definitions.get(key) || [];
        const target = witness(item, span);
        if (!candidates.some(value => same(value, target))) candidates.push(target);
        if (candidates.length > 16) throw fail('SemanticDB symbol candidate budget exhausted.');
        definitions.set(key, candidates);
      } else if (occurrence.role === 1) pending.push({ filename, symbol: occurrence.symbol, span, family: 'semanticdbReference' });
    }
    for (const diagnostic of document.diagnostics || []) {
      check();
      if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'semanticdb_compiler_diagnostic',
        severity: diagnostic.severity ?? 0, message: String(diagnostic.message || '').slice(0, 2048), span: spanAt(item, diagnostic.range) });
      else result.omittedDiagnostics = (result.omittedDiagnostics || 0) + 1;
    }
    for (const synthetic of document.synthetics || []) {
      check();
      const span = spanAt(item, synthetic.range);
      result.synthetics.push({ span, range: synthetic.range || null, tree: synthetic.tree || null,
        evidence: 'compiler-synthetic', state: span ? 'source-qualified-anchor' : 'unmapped' });
      const callSymbol = tree => tree?.unknownFields?.length ? null : tree?.id?.symbol || tree?.select?.id?.symbol
        || (tree?.typeApply ? callSymbol(tree.typeApply.function) : null);
      const stack = [synthetic.tree];
      while (stack.length) {
        check();
        const tree = stack.pop();
        if (!tree || tree.unknownFields?.length) continue;
        if (tree.apply) {
          const symbol = callSymbol(tree.apply.function);
          if (span && symbol) {
            if (!label(symbol)) throw fail('Invalid SemanticDB synthetic application symbol.');
            pending.push({ filename, symbol, span, family: 'semanticdbSyntheticApplication' });
          }
          stack.push(tree.apply.function, ...(tree.apply.arguments || []));
        }
        if (tree.select) stack.push(tree.select.qualifier);
        if (tree.typeApply) stack.push(tree.typeApply.function);
      }
    }
  }
  for (const entry of pending) {
    check();
    if (++referenceCount > maxReferences) throw fail('SemanticDB reference budget exhausted.');
    const candidates = definitions.get(symbolKey(entry.symbol, entry.filename)) || [];
    const target = candidates.length === 1 ? candidates[0] : null;
    results.get(entry.filename).references.push({ family: entry.family, name: entry.symbol, span: entry.span,
      target, candidates, state: target ? 'resolved' : 'unresolved',
      reason: target ? null : candidates.length ? 'ambiguous_symbol_in_build_target' : 'external_or_missing_definition',
      evidence: entry.family === 'semanticdbSyntheticApplication' ? 'compiler-synthetic' : 'compiler-occurrence' });
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'scala-semanticdb-import', adapterVersion: '3',
    method: 'scala/semanticdb4', evidenceKind: 'scala-semanticdb-references', generation,
    runtime: { family: receipt.tool.family, version: receipt.tool.version, profileHash: receipt.profileHash,
      qualification: 'producing-receipt-and-application-decoder-unqualified', compilerVersion: receipt.tool.compilerVersion,
      decoderVersion: decoded.runtimeVersion },
    project: { configHash: receipt.configHash, dependencyHash: receipt.dependencyHash, classpathHash: receipt.classpathHash,
      buildTarget: receipt.buildTarget, targetPlatform: receipt.targetPlatform, producingReceiptHash: expectedReceiptHash },
    results: [...results.values()], artifact: { hash: artifactHash, encoding: 'base64', base64: bytes.toString('base64') },
    coverage: { sourceQualifiedOccurrences: true, syntheticApplications: 'bounded-observation',
      structuredSignatures: false, opaqueSignaturesRetained: true, tasty: false, compilerExecution: false,
      normalScalaSyntaxAdmission: false, metalsRuntime: false },
    metrics: { sourceBytes, referenceCount, decodedNodes: decoded.nodes, wireFields: decoded.fieldCount } };
  check();
  return { status: 'partial', artifactHash, report: finalizeSourceLinkedReport(report,
    { maxBytes: SEMANTICDB_PROVIDER_DECLARATION.limits.maxBytes, fail, message: 'SemanticDB evidence output byte budget exhausted.', check }) };
};
