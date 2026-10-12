import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSemanticJson } from '../../semantic/identity.js';
import { getTypeScriptLoadReceipt } from './load.js';
import { createFiniteStringFrontend } from './type-ir/frontend.js';
import { createTypeIrArena, serializeTypeIrRoots } from './type-ir/index.js';
import { createSymbolicTypeGraph, normalizeTypeExpressions } from '../../../shared/symbolic-types.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { ToolingRequiredComputationError } from '../required-computation.js';

export const TYPESCRIPT_SYMBOLIC_FRONTEND_VERSION = 1;
export const requiredSymbolicComputation = (reason, details = null) => new ToolingRequiredComputationError(
  'TypeScript symbolic enrichment requires an answer that is not available: ' + reason,
  { operation: 'typescript-symbolic-provider', reason, details }
);

/** A deterministic identity of this evaluated compiler context, not authority
 * for replay before live dependency validation. Reuse the existing compiler
 * system's observed config/package/resolver probes, including negative probes.
 * The raw source texts are hashed incrementally and are never copied into IR.
 */
export const createSymbolicEvaluationContext = ({ ts, program, observations, rootNames, options,
  projectReferences = [], documents, configPath = null, signal }) => {
  const receipt = getTypeScriptLoadReceipt(ts);
  if (!receipt || !(observations instanceof Map)) throw requiredSymbolicComputation('compiler_context_authority_missing');
  const hash = createHash('sha256');
  let metadataBytes = 0, sourceBytes = 0;
  const charge = value => {
    throwIfAborted(signal);
    const text = canonicalSemanticJson(value);
    metadataBytes += Buffer.byteLength(text, 'utf8');
    if (metadataBytes > 64 * 1024 * 1024) throw requiredSymbolicComputation('context_metadata_budget');
    hash.update(text, 'utf8').update('\n');
  };
  charge({ schemaVersion: 1, frontendVersion: TYPESCRIPT_SYMBOLIC_FRONTEND_VERSION,
    compilerVersion: ts.version, compilerReceipt: receipt, configPath,
    // Same explicit JSON options projection as compiler-dependency inventory.
    options: JSON.parse(JSON.stringify(options)), rootNames,
    projectReferences: JSON.parse(JSON.stringify(projectReferences)) });
  for (const source of program.getSourceFiles()) {
    throwIfAborted(signal);
    sourceBytes += Buffer.byteLength(source.text, 'utf8');
    if (sourceBytes > 256 * 1024 * 1024) throw requiredSymbolicComputation('context_source_budget');
    charge({ fileName: path.resolve(source.fileName),
      hash: createHash('sha256').update(source.text, 'utf8').digest('hex'),
      scriptKind: source.scriptKind ?? null, impliedNodeFormat: source.impliedNodeFormat ?? null });
  }
  for (const document of documents) charge({ virtualPath: document.virtualPath,
    containerPath: document.containerPath || null, segmentUid: document.segmentUid || null,
    sourceUnitId: document.sourceUnitId || null, sourceHash: document.sourceHash || null,
    segmentRange: document.segmentRange || null, mappingIdentity: document.mappingIdentity || null,
    mappingQuality: document.mappingQuality || null });
  const observationKeys = [...observations.keys()].sort();
  for (const key of observationKeys) charge(observations.get(key));
  const contextKey = 'ts-evaluated-v1:' + hash.digest('hex');
  return { contextKey, metadataBytes, sourceBytes,
    assertUnchanged() {
      // Symbol-only lowering must not acquire new compiler inputs after identity
      // capture. Existing entries are immutable inside the observation owner.
      if (observations.size !== observationKeys.length) throw requiredSymbolicComputation('compiler_context_changed_during_lowering');
    } };
};

/** Shared graph projection. Every supported declaration contributes roots to
 * one multi-root graph; a union wrapper would erase nested union root handles.
 */
export const createFiniteStringProjection = ({ ts, checker, contextKey, signal, documents = [], repoRoot }) => {
  const arena = createTypeIrArena({ contextKey });
  const frontend = createFiniteStringFrontend({ ts, checker, arena, signal });
  const roots = new Map();
  const origins = new Map();
  for (const document of documents) {
    const range = document.segmentRange || (!document.segmentUid ? { start: 0, end: document.text.length } : null);
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end < range.start || range.end - range.start !== document.text.length)) {
      throw requiredSymbolicComputation('virtual_source_mapping_invalid', { virtualPath: document.virtualPath });
    }
    origins.set(pathToFileURL(path.resolve(repoRoot, document.virtualPath)).href, {
      kind: 'virtual', virtualPath: document.virtualPath, containerPath: document.containerPath || null,
      segmentUid: document.segmentUid || null, segmentRange: range,
      mappingIdentity: document.mappingIdentity || null,
      mappingQuality: document.mappingQuality || (range && document.containerPath ? 'exact' : 'unmapped')
    });
  }
  const withOrigin = ref => origins.has(ref.sourceId) ? { ...ref, origin: origins.get(ref.sourceId) } : ref;
  return {
    collect(node) {
      const result = frontend.lowerFunctionDeclaration(node);
      if (result.status !== 'complete') throw requiredSymbolicComputation(result.reason, { obligations: result.obligations });
      roots.set(result.returnType.id, result.returnType);
      for (const refs of Object.values(result.params)) for (const root of refs) roots.set(root.id, root);
      const signatureIdentity = 'type-expressions-v1:' + createHash('sha256').update(canonicalSemanticJson({
        returnType: result.returnType.id,
        parameters: Object.entries(result.params).map(([name, refs]) => [name, refs.map(root => root.id)])
      })).digest('hex');
      return { ...result, declarationRef: withOrigin(result.declarationRef),
        provenance: result.provenance.map(withOrigin), signatureIdentity };
    },
    finish() {
      throwIfAborted(signal);
      if (!roots.size) return null;
      return createSymbolicTypeGraph(serializeTypeIrRoots(arena, [...roots.values()], { signal }));
    },
    stats() { return { frontend: frontend.stats(), arena: arena.stats() }; }
  };
};

export const projectFiniteStringDeclaration = (result, entry) => {
  const ref = root => ({ schemaVersion: 1, domain: 'finite-string', graphId: entry.graphId,
    contextKey: entry.graph.contextKey, nodeId: root.id });
  const params = Object.create(null);
  for (const [name, roots] of Object.entries(result.params)) params[name] = roots.map(ref);
  return normalizeTypeExpressions({ schemaVersion: 1, interpretation: 'declared-type-denotation', returnType: ref(result.returnType), params,
    declarationRef: result.declarationRef, provenance: result.provenance, display: {} });
};
