import { API_CONTRACT_REPORT_VERSION } from '../../../src/contracts/schemas/api-contracts.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTypeScriptChunksFromAst } from '../../../src/lang/typescript/chunks-ast.js';
import { buildTypeScriptChunksFromBabel } from '../../../src/lang/typescript/chunks-babel.js';
import { extractTypeScriptDocMeta } from '../../../src/lang/typescript/doc.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('typescript-parameter-authority');
const text = `export function required(callback: () => void) {}
export function optional(callback?: () => void) {}
export function defaulted(callback: () => void = () => {}) {}
export function receiver(this: void, value: number) {}
export function onlyThis(this: void) {}
required();
required(() => {});
optional();
defaulted();
receiver(1);
receiver();
onlyThis();
`;
try {
  const inputPath = path.join(root, 'input.ts'); await fs.writeFile(inputPath, text);
  const { ts } = prepareTypeScriptSyntax('', { ext: '.ts' });
  const program = ts.createProgram([inputPath], { noLib: true, strict: true, noEmit: true, target: ts.ScriptTarget.Latest });
  const sourceFile = program.getSourceFile(inputPath);
  const diagnostics = program.getSemanticDiagnostics(sourceFile).filter(diagnostic => diagnostic.code === 2554);
  assert.equal(diagnostics.length, 2, 'independent compiler oracle: required callback and runtime value are missing');
  assert.deepEqual(diagnostics.map(diagnostic => text.slice(diagnostic.start).split('(')[0]).sort(), ['receiver', 'required']);
  for (const [parser, build] of [['typescript', buildTypeScriptChunksFromAst], ['babel', buildTypeScriptChunksFromBabel]]) {
    const chunks = build(text, { ext: '.ts', ts, sourceFile });
    const payloads = chunks.filter(chunk => chunk.meta.callableParameters).map((chunk, index) => buildChunkPayload({
      chunk: { ...chunk, startLine: chunk.meta.startLine, endLine: chunk.meta.endLine, chunkUid: `callable-${index}`, spanIndex: index },
      rel: 'input.ts', relKey: 'input.ts', ext: '.ts', effectiveExt: '.ts', languageId: 'typescript', fileSize: text.length,
      tokens: [], tokenIds: [], identifierTokens: [], keywordTokens: [], operatorTokens: [], literalTokens: [], seq: [],
      codeRelations: {}, docmeta: { ...extractTypeScriptDocMeta(chunk), exported: true, exportNames: [chunk.name] }, stats: {},
      complexity: null, lint: null, preContext: null, postContext: null, minhashSig: [], commentFieldTokens: [], dictWords: new Set(),
      dictConfig: {}, postingsConfig: {}, emitFieldTokens: false, tokenMode: 'code', fileRelations: null, relationsEnabled: false,
      toolInfo: { tool: 'test', version: '0.0.0' }, gitMeta: {}, analysisPolicy: null }));
    const outDir = path.join(root, parser); await fs.mkdir(outDir);
    const writes = [];
    await enqueueSymbolsArtifacts({ state: { chunks: payloads }, outDir,
      enqueueWrite: (_label, write) => writes.push(write), addPieceFile: () => {}, formatArtifactLabel: value => value });
    for (const write of writes) await write();
    const rows = (await fs.readFile(path.join(outDir, 'symbols.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(validateArtifact('symbols', rows).ok, true);
    assert.equal(rows.length, 5);
    const byName = new Map(rows.map(row => [row.name, row]));
    for (const row of rows) assert.equal(row.extensions.callableParameters.source, 'parser-node');
    assert.equal(byName.get('required').extensions.callableParameters.arity.min, 1);
    assert.equal(byName.get('receiver').extensions.callableParameters.formalSlotCount, 2);
    assert.equal(byName.get('receiver').extensions.callableParameters.runtimeSlotCount, 1);
    assert.equal(byName.get('onlyThis').extensions.callableParameters.arity.max, 0);
    const relations = buildTypeScriptRelations(text, chunks, { ext: '.ts', parser: 'babel' });
    // Closed local fixture: these uniquely named declarations own every target;
    // production target resolution is exercised separately by the CLI fixture.
    const callSites = createCallSites({ chunks: [{ file: 'input.ts', chunkUid: 'module-caller', lang: 'typescript',
      codeRelations: { callDetails: relations.callDetails.map(detail => ({ ...detail,
        targetChunkUid: byName.get(detail.calleeNormalized)?.chunkUid || null })) } }] });
    assert.equal(callSites.length, 7);
    const input = { symbols: rows, callSites, indexSignature: 'parameter-generation', indexCompatKey: 'parameter-compat' };
    const report = buildApiContractsReport(input);
    assert.equal(validateApiContracts(report).ok, true);
    assert.equal(report.version, API_CONTRACT_REPORT_VERSION);
    assert.equal(report.warnings.length, 2);
    assert.ok(report.warnings.every(warning => warning.code === 'ARITY_MISMATCH'));
    assert.deepEqual(report.warnings.map(warning => rows.find(row => row.symbolId === warning.data.symbolId).name).sort(), ['receiver', 'required']);
    for (const warning of report.warnings) {
      const call = callSites.find(call => call.callSiteId === warning.data.callSiteId);
      assert.ok(diagnostics.some(diagnostic => diagnostic.start === call.start), 'the source diagnostic identifies the same bad call');
    }
    assert.throws(() => buildApiContractsReport({ ...input, failOnWarn: true, caps: { maxWarnings: 0 } }), error => error.code === 'ERR_API_CONTRACT_WARN');
    const trimmedDisplay = rows.map(row => ({ ...row, signature: null }));
    assert.equal(buildApiContractsReport({ ...input, symbols: trimmedDisplay }).warnings.length, 2,
      'source parameter authority survives absent display signatures');
    const malformed = structuredClone(rows); malformed[0].extensions.callableParameters.arity.min = 99;
    assert.equal(validateArtifact('symbols', malformed).ok, false, 'impossible arity cannot qualify a persisted symbol');
    const trimDir = path.join(outDir, 'trim'); await fs.mkdir(trimDir);
    const trimWrites = [];
    await enqueueSymbolsArtifacts({ state: { chunks: [{ ...payloads[0], metaV2: { ...payloads[0].metaV2, name: 'n'.repeat(40000) } }] }, outDir: trimDir,
      enqueueWrite: (_label, write) => trimWrites.push(write), addPieceFile: () => {}, formatArtifactLabel: value => value });
    for (const write of trimWrites) await write();
    const trimmed = JSON.parse((await fs.readFile(path.join(trimDir, 'symbols.jsonl'), 'utf8')).trim());
    assert.equal(trimmed.signature, null); assert.equal(trimmed.name, null);
    assert.equal(trimmed.extensions.callableParameters.arity.min, 1, 'actual row trimming preserves independent source arity');
    assert.equal(validateArtifact('symbols', [trimmed]).ok, true);
  }
  const symbol = { symbolId: 'legacy', chunkUid: 'legacy-chunk', file: 'legacy.ts', lang: 'typescript', signature: 'accept(callback: () => void)' };
  const call = { callSiteId: 'legacy-call', targetChunkUid: 'legacy-chunk', file: 'use.ts', args: [] };
  const legacy = signature => buildApiContractsReport({ symbols: [{ ...symbol, signature }], callSites: [call], indexSignature: 'legacy-generation' });
  assert.equal(legacy(symbol.signature).warnings[0].code, 'ARITY_MISMATCH');
  assert.equal(legacy('accept(callback?: () => void)').warnings, null);
  assert.equal(legacy('accept(callback: () => void = () => {})').warnings, null);
  assert.equal(legacy('accept(this: void)').warnings, null);
  assert.equal(legacy('@tag(extra) accept(value: number)').warnings[0].code, 'CALLABLE_PARAMETER_AUTHORITY_UNAVAILABLE');
  const foreignLanguage = buildApiContractsReport({ symbols: [{ ...symbol, file: 'legacy.py', lang: 'python' }], callSites: [call], indexSignature: 'legacy-generation' });
  assert.equal(foreignLanguage.warnings[0].code, 'CALLABLE_PARAMETER_AUTHORITY_UNAVAILABLE', 'same display text cannot borrow another language cache entry');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('API TypeScript source parameter authority/writer replay test passed');
