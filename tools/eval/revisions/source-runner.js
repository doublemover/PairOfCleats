import { randomUUID } from 'node:crypto';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { SOURCE_REVISION_PROFILE, SOURCE_REVISION_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-source.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { finiteViewFields } from '../../../src/index/semantic/views/finite-input.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { compileSourceRevisionScenario, realizeSourceFile, sourceBytesHash, sourceStateId, sealSourceRevisionEdits, sourceScenarioError } from './source-scenario.js';
import { referenceSourceRevision, captureSourceRevisionOutput } from './source-reference.js';
import { revisionKey, revisionScenarioId } from './scenario.js';
import { minimizeRevisionSequence } from './minimize.js';

const owned = new WeakMap(), validate = compileSchema(createAjv({ strict: true, allErrors: true }), SOURCE_REVISION_RECEIPT_SCHEMA);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const run = owned.get(handle); if (!run) throw new TypeError('Original source revision execution required.'); return run; };

/** Cache entries belong to this invocation and exact source/path/parser world.
 * Removed paths are absent from the next Map. No AST/native handle survives a
 * parse; reuse retains only immutable source identity and producer projections. */
const candidate = (scenario, files, previous, check, signal) => {
  const next = new Map(); let parsedFiles = 0, reusedFiles = 0, parsedSourceBytes = 0;
  for (const file of files) {
    throwIfAborted(signal); if (!check()) return null;
    const text = realizeSourceFile(file), bytes = Buffer.from(text, 'utf8'), byteHash = sourceBytesHash(bytes), old = previous.get(file.path);
    if (old && old.byteHash === byteHash && old.text === text) { next.set(file.path, old); reusedFiles++; continue; }
    parsedFiles++; parsedSourceBytes += bytes.byteLength;
    const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: scenario.repositoryNamespace, path: file.path, language: 'javascript', dialect: '.js' });
    throwIfAborted(signal); if (!check()) return null;
    const options = { ext: '.js', parser: scenario.parser, flowMode: 'off' }, ast = parseJavaScriptAst(snapshot.text, options);
    const parser = ast ? getJavaScriptSyntaxIdentity(ast) : null, qualified = Boolean(ast && parser && !ast.errors?.length);
    const chunks = qualified ? buildJsChunks(snapshot.text, { ...options, ast }) : null;
    const { manifest } = snapshot;
    const entry = freeze({ byteHash, text, complete: Boolean(qualified && chunks), output: { path: file.path, byteHash: manifest.byteHash,
      textLength: manifest.textLength, byteLength: manifest.byteLength, chunks: (chunks || []).map(chunk => ({ name: chunk.name, kind: chunk.kind,
        start: chunk.start, end: chunk.end, startLine: chunk.meta?.startLine ?? null, endLine: chunk.meta?.endLine ?? null,
        text: snapshot.text.slice(chunk.start, chunk.end) })) }, source: { path: file.path, sourceUnitId: manifest.sourceUnitId,
      byteHash: manifest.byteHash, textHash: manifest.textHash, textLength: manifest.textLength, byteLength: manifest.byteLength,
      lineStarts: manifest.lineStarts, parser, declarationIds: (chunks || []).map(chunk => chunk.meta?.jsDeclaration?.id ?? null) } });
    next.set(file.path, entry);
  }
  const entries = [...next.values()], complete = entries.every(entry => entry.complete);
  return { cache: next, complete, output: captureSourceRevisionOutput(entries.map(entry => entry.output)), sources: entries.map(entry => entry.source),
    work: { parsedFiles, reusedFiles, removedFiles: [...previous.keys()].filter(path => !next.has(path)).length, parsedSourceBytes } };
};
export const runSourceRevisionScenario = (input, options = {}) => {
  const began = performance.now();
  const { signal = null, maxMs = 1000, maxReferenceFiles = 8 } = finiteViewFields(options, [], ['signal', 'maxMs', 'maxReferenceFiles'], sourceScenarioError);
  throwIfAborted(signal);
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000 || !Number.isSafeInteger(maxReferenceFiles) || maxReferenceFiles < 0 || maxReferenceFiles > 8) {
    throw sourceScenarioError('Invalid source revision execution allowance.');
  }
  const compiled = compileSourceRevisionScenario(input), check = () => performance.now() - began < maxMs, checkpoints = [];
  let cache = new Map(), stopped = false, retainedDisagreement = false;
  for (const [index, files] of compiled.states.entries()) {
    throwIfAborted(signal);
    const checkpointId = index ? compiled.scenario.revisions[index - 1].id : 'base', stateId = sourceStateId(files);
    const notRun = () => { stopped = true; checkpoints.push({ index, checkpointId, stateId, outcome: 'not-run', reason: 'run-work-budget' }); };
    if (stopped || !check()) { notRun(); continue; }
    const candidateBegan = performance.now(), actual = candidate(compiled.scenario, files, cache, check, signal);
    if (!actual) { notRun(); continue; }
    const candidateMs = performance.now() - candidateBegan; cache = actual.cache;
    const rebuildBegan = performance.now(), fresh = candidate(compiled.scenario, files, new Map(), check, signal);
    if (!fresh) { notRun(); continue; }
    const rebuildMs = performance.now() - rebuildBegan, referenceBegan = performance.now();
    const reference = referenceSourceRevision(files, { signal, maxReferenceFiles, check });
    const independent = !actual.complete || reference.output === null ? 'unknown' : revisionKey(actual.output) === revisionKey(reference.output) ? 'pass' : 'fail';
    const parity = revisionKey(actual.output) === revisionKey(fresh.output) && revisionKey(actual.sources) === revisionKey(fresh.sources);
    const retain = independent === 'fail' && !retainedDisagreement; if (retain) retainedDisagreement = true;
    checkpoints.push({ index, checkpointId, stateId, outcome: !parity || independent === 'fail' ? 'fail' : independent,
      candidateExecutionId: randomUUID(), rebuildExecutionId: randomUUID(), candidateOutputId: revisionScenarioId(actual.output), rebuildOutputId: revisionScenarioId(fresh.output),
      referenceOutputId: reference.output ? revisionScenarioId(reference.output) : null, sources: actual.sources,
      claims: [{ tier: 'independent-source-construction-grammar', relation: 'exact-utf16-declaration-ranges-and-source-bytes', outcome: independent,
        reason: !actual.complete ? 'candidate-parser-unqualified' : reference.reason, counterexample: retain ? { expected: reference.output, actual: actual.output } : null },
      { tier: 'same-implementation-clean-rebuild', relation: 'exact-output-and-source-identities', outcome: parity ? 'pass' : 'fail' }],
      work: { candidateMs, rebuildMs, referenceMs: performance.now() - referenceBegan, ...actual.work, referenceFiles: reference.examined } });
  }
  const executionId = randomUUID(), receipt = freeze({ schemaVersion: 1, kind: 'tiny-javascript-source-revision-run', profile: SOURCE_REVISION_PROFILE,
    scenarioId: compiled.scenarioId, executionId, family: compiled.scenario.family, seed: compiled.scenario.seed,
    outcome: checkpoints.some(row => row.outcome === 'fail') ? 'fail' : checkpoints.every(row => row.outcome === 'pass') ? 'pass' : 'unknown', checkpoints,
    producer: { javascriptRelations: SEMANTIC_ANALYSIS_VERSIONS.javascriptRelations, sourceChunking: SEMANTIC_ANALYSIS_VERSIONS.sourceChunking },
    scope: 'constructed-javascript-function-declarations; no-execution-or-index-publication',
    candidateStrategy: 'reuse-exact-unchanged-file; reparse-changed-file; retract-removed-file',
    limits: { maxMs, maxReferenceFiles, sourceBytes: 65536, receiptBytes: 262144 }, elapsedMs: performance.now() - began });
  if (!validate(receipt)) throw sourceScenarioError('Invalid original source revision receipt.');
  if (Buffer.byteLength(revisionKey(receipt)) > 262144) throw sourceScenarioError('Source revision receipt exceeds its output allowance.');
  const handle = Object.freeze({ executionId, scenarioId: compiled.scenarioId }); owned.set(handle, { compiled, receipt }); return handle;
};
export const readSourceRevisionRun = handle => get(handle).receipt;
export const retireSourceRevisionRun = handle => { const run = get(handle); owned.delete(handle); return Object.freeze({ executionId: run.receipt.executionId, retired: true }); };
export const minimizeSourceRevisionFailure = (handle, { checkpointId, maxAttempts = 32, maxMs = 1000, signal = null } = {}) => {
  const original = get(handle);
  return minimizeRevisionSequence({ originalScenario: original.compiled.scenario, originalReceipt: original.receipt,
    matches: receipt => receipt.checkpoints.some(row => row.checkpointId === checkpointId && row.claims?.some(claim => claim.tier === 'independent-source-construction-grammar' && claim.outcome === 'fail')),
    seal: sealSourceRevisionEdits, invalidScenario: error => error?.code === 'ERR_SOURCE_REVISION_SCENARIO', run: runSourceRevisionScenario,
    read: readSourceRevisionRun, dispose: retireSourceRevisionRun, kind: 'tiny-source-revision-minimization', selection: { checkpointId },
    predicate: 'same-checkpoint-independent-source-projection-disagreement-v1' }, { checkpointId, maxAttempts, maxMs, signal });
};
