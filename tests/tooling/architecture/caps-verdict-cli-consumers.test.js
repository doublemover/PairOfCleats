import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { CROSS_FILE_FIDELITY_VERSION, resolveCrossFileFidelity } from '../../../src/index/cross-file-fidelity.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { computeCompatibilityKey } from '../../../src/integrations/core/build-index/compatibility.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { getBuildsRoot, getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadPiecesManifest, loadGraphRelations, readCompatibilityKey } from '../../../src/shared/artifact-io.js';
import { validateArchitectureReport } from '../../../src/contracts/validators/analysis.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/architecture/caps-verdict-cli-consumers/')[1];
const specifications = {
  'omitted-violation': { caps: [], detected: 1, retained: 1, omitted: 0, complete: true, exit: 2 },
  clean: { caps: [], detected: 0, retained: 0, omitted: 0, complete: true, exit: 0 },
  'max-violations-only': { caps: ['--maxViolations', '1'], maxViolations: 1, detected: 1, retained: 1, omitted: 0, complete: true, exit: 2 },
  'max-edges-only': { caps: ['--maxEdgesExamined', '2'], maxEdgesExamined: 2, detected: 1, retained: 1, omitted: 0, complete: true, exit: 2 },
  'zero-details': { caps: ['--maxViolations', '0'], maxViolations: 0, detected: 1, retained: 0, omitted: 1, complete: true, exit: 2, reportOnly: true },
  'zero-work': { caps: ['--maxEdgesExamined', '0'], maxEdgesExamined: 0, detected: 0, retained: 0, omitted: 0, complete: false, exit: 1, reportOnly: true },
  'unknown-upstream': { caps: [], detected: 0, retained: 0, omitted: 0, complete: false, exit: 1, reportOnly: true }
};
assert.ok(Object.hasOwn(specifications, selected));
const spec = specifications[selected], { dir } = await prepareIsolatedTestCacheDir('architecture-cli-' + selected);
const identity = await fs.lstat(dir, { bigint: true }), repo = path.join(dir, 'repo'), elsewhere = path.join(dir, 'unrelated');
await fs.mkdir(path.join(repo, 'src'), { recursive: true }); await fs.mkdir(elsewhere);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
  testConfig: { indexing: { scm: { provider: 'none' } }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } } });
const logger = createLoggerScope(), messages = [];
logger.setProgressHandlers({ log(message) { assert.ok(messages.length < 2000); messages.push(message); } });
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const noEdge = selected === 'clean' || selected === 'unknown-upstream';
const files = [
  { file: 'src/a.js', text: noEdge ? 'export function a() { return 1; }\n'
    : 'import { b } from "./b.js";\nexport function a() { return b(); }\n' },
  { file: 'src/b.js', text: 'export function b() { return 2; }\n' }
];
// This is a completely enumerated two-file graph fixture, not a claim that a
// normal compiler/provider has complete analysis of arbitrary JavaScript.
const completeCoverage = { schemaVersion: CROSS_FILE_FIDELITY_VERSION, policy: resolveCrossFileFidelity('comprehensive'),
  fingerprint: hash(JSON.stringify(files)), admission: { status: 'complete', firstLayer: null, propagation: null },
  analysis: { status: 'complete', reasons: [] } };
const graph = { nodeCount: 2, edgeCount: noEdge ? 0 : 1, nodes: [
  { id: 'src/a.js', out: noEdge ? [] : ['src/b.js'], in: [] },
  { id: 'src/b.js', out: [], in: noEdge ? [] : ['src/a.js'] }
] };
let failed = false, primary;
try {
  const chunks = [], fileInfoByPath = new Map();
  for (const [id, file] of files.entries()) {
    await fs.writeFile(path.join(repo, file.file), file.text);
    const lineIndex = buildLineIndex(file.text), fileHash = hash(file.text, 'sha1');
    const chunk = { id, file: file.file, name: file.file, kind: 'File', start: 0, end: file.text.length };
    const ids = await prepareChunkIds({ chunks: [chunk], text: file.text, relKey: file.file, containerExt: '.js', containerLanguageId: 'javascript',
      lineIndex, fileHash, fileHashAlgo: 'sha1', vfsManifestConcurrency: 1, strict: true });
    const tokenized = buildTokenSequence({ text: file.text, mode: 'code', ext: '.js', dictWords: new Set(), dictConfig: {}, includeSeq: true });
    const payload = buildChunkPayload({ chunk: { ...chunk, ...ids.chunkLineRanges[0] }, rel: file.file, relKey: file.file,
      ext: '.js', effectiveExt: '.js', languageId: 'javascript', fileHash, fileHashAlgo: 'sha1', fileSize: Buffer.byteLength(file.text),
      tokens: tokenized.tokens, tokenIds: [], seq: tokenized.seq, codeRelations: {}, docmeta: {}, stats: {}, minhashSig: [],
      commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {}, tokenMode: 'code',
      toolInfo: { tool: 'architecture-cli-closed-graph-fixture', version: '1' }, gitMeta: {} });
    assert.equal(payload.chunkUid, chunk.chunkUid); assert.equal(payload.metaV2.chunkUid, chunk.chunkUid);
    assert.equal(payload.endLine, offsetToLine(lineIndex, Math.max(0, file.text.length - 1)));
    chunks.push({ ...payload, id, tokenCount: payload.tokens.length });
    fileInfoByPath.set(file.file, { size: Buffer.byteLength(file.text), hash: fileHash, hashAlgo: 'sha1' });
  }
  const df = new Map(), tokenPostings = new Map();
  for (const [id, chunk] of chunks.entries()) for (const token of new Set(chunk.tokens)) {
    df.set(token, (df.get(token) || 0) + 1); const list = tokenPostings.get(token) || [];
    list.push([id, chunk.tokens.filter(value => value === token).length]); tokenPostings.set(token, list);
  }
  const docLengths = chunks.map(chunk => chunk.tokens.length);
  const postings = await buildPostings({ chunks, df, tokenPostings, docLengths, fieldPostings: {}, fieldDocLengths: {},
    phrasePost: new Map(), triPost: new Map(), postingsConfig: {}, embeddingsEnabled: false, modelId: 'stub', useStubEmbeddings: true, log() {} });
  const config = loadUserConfig(repo), buildId = 'architecture-' + selected, buildRoot = path.join(getBuildsRoot(repo, config), buildId);
  const outDir = path.join(buildRoot, 'index-code'); await fs.mkdir(outDir, { recursive: true });
  const compatibilityRuntime = { dictConfig: {}, dictSignature: null, postingsConfig: {}, commentsConfig: {},
    segmentsConfig: {}, languageOptions: {}, embeddingEnabled: false, embeddingService: false };
  computeCompatibilityKey({ runtime: compatibilityRuntime, modes: ['code'], sharedDiscovery: { code: { entries: files } } });
  const compatibilityKey = compatibilityRuntime.compatibilityKey;
  assert.match(compatibilityKey, /^[a-f0-9]{40}$/);
  const state = { chunks, scannedFilesTimes: [], scannedFiles: files.map(file => file.file), skippedFiles: [],
    totalTokens: docLengths.reduce((sum, value) => sum + value, 0), docLengths, fileRelations: new Map(), fileInfoByPath,
    fileDetailsByPath: new Map(), chunkUidToFile: new Map(chunks.map(chunk => [chunk.chunkUid, chunk.file])),
    vfsManifestRows: [], vfsManifestCollector: null, fieldTokens: [], importResolutionGraph: null,
    ...(selected === 'unknown-upstream' ? {} : { crossFileCoverage: completeCoverage }) };
  await logger.run(() => writeIndexArtifacts({ root: repo, outDir, buildRoot, mode: 'code', state, postings, postingsConfig: {},
    modelId: 'stub', useStubEmbeddings: true, dictSummary: null, timing: { start: Date.now() }, incrementalEnabled: false,
    fileCounts: { candidates: 2 }, perfProfile: null, userConfig: { indexing: { scm: { provider: 'none' } } },
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, compatibilityKey,
      tokenizationKey: compatibilityRuntime.tokenizationKeys.code, buildId, mode: 'code', stage: 'stage2', counts: { files: 2, chunks: 2 },
      generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    graphRelations: { version: 2, callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }, importGraph: graph }, stageCheckpoints: null }));
  await logger.run(() => promoteBuild({ repoRoot: repo, userConfig: config, buildId, buildRoot, compatibilityKey, stage: 'stage2', modes: ['code'] }));
  assert.equal(path.relative(getIndexDir(repo, 'code', config), outDir), '');
  const manifest = loadPiecesManifest(outDir, { strict: true }); assert.equal(manifest.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  assert.equal(manifest.compatibilityKey, compatibilityKey);
  assert.equal(readCompatibilityKey(outDir, { strict: true }).key, compatibilityKey);
  const published = await loadGraphRelations(outDir, { manifest, strict: true });
  assert.equal(published.importGraph.edgeCount, noEdge ? 0 : 1);
  const rulesPath = path.join(dir, 'rules.json');
  await fs.writeFile(rulesPath, JSON.stringify({ version: 1, rules: [
    { id: 'deny-ab', type: 'forbiddenImport', from: { anyOf: ['src/a.js'] }, to: { anyOf: ['src/b.js'] } }
  ] }));
  const run = enforce => spawnSubprocess(process.execPath, [path.resolve('tools/analysis/architecture-check.js'), '--repo', repo,
    '--rules', rulesPath, '--json', ...spec.caps, ...(enforce ? ['--fail-on-violation'] : [])],
  { env, cwd: elsewhere, timeoutMs: 5000, maxOutputBytes: 512 * 1024, rejectOnNonZeroExit: false });
  const verify = result => {
    const report = JSON.parse(result.stdout), validation = validateArchitectureReport(report);
    assert.equal(validation.ok, true, validation.errors?.join('; '));
    assert.deepEqual(report.summary, { detectedViolations: spec.detected, retainedViolations: spec.retained, omittedViolations: spec.omitted,
      edgesExamined: selected === 'zero-work' || noEdge ? 0 : 1, complete: spec.complete });
    assert.equal(report.violations.length, spec.retained);
    assert.equal(report.provenance.indexCompatKey, compatibilityKey);
    assert.equal(report.rules[0].summary.violations, spec.detected);
    assert.deepEqual(report.provenance.capsUsed.architecture, { maxViolations: spec.maxViolations ?? null, maxEdgesExamined: spec.maxEdgesExamined ?? null });
    if (spec.retained) {
      assert.equal(report.violations[0].ruleId, 'deny-ab'); assert.equal(report.violations[0].edge.edgeType, 'import');
      assert.equal(report.violations[0].edge.from.path, 'src/a.js'); assert.equal(report.violations[0].edge.to.path, 'src/b.js');
    }
    if (selected === 'unknown-upstream') assert.ok(report.warnings.some(warning => warning.code === 'UPSTREAM_RELATION_COVERAGE_INCOMPLETE'));
    return report;
  };
  const enforced = await run(true); assert.equal(enforced.exitCode, spec.exit, enforced.stderr);
  assert.equal(enforced.stderr.trim(), spec.exit === 2 ? 'Architecture violations detected.'
    : spec.exit === 1 ? 'Architecture evaluation is incomplete; a clean verdict is unavailable.' : '');
  const report = verify(enforced);
  if (spec.reportOnly) {
    const normal = await run(false); assert.equal(normal.exitCode, 0); assert.equal(normal.stderr, '');
    const normalReport = verify(normal); assert.deepEqual(normalReport.summary, report.summary);
    assert.deepEqual(normalReport.violations, report.violations, 'successful transport retains the original partial/detected report');
  }
  console.log(JSON.stringify({ selected, sourceHashes: files.map(file => ({ file: file.file, sha256: hash(file.text) })),
    artifactSurfaceVersion: manifest.artifactSurfaceVersion, compatibilityKey, canonicalUids: chunks.map(chunk => chunk.chunkUid),
    manifestSha256: hash(await fs.readFile(path.join(outDir, 'pieces/manifest.json'))), cliExit: enforced.exitCode,
    summary: report.summary, caps: report.provenance.capsUsed.architecture,
    scope: 'actual artifact writer/promotion/strict graph readers/CLI;independently enumerated two-file graph;not full-index/provider or editor qualification' }));
} catch (error) { failed = true; primary = error; }
finally {
  for (const operation of [() => logger.close(), async () => {
    if (failed) observeStorageResource(primary).requireSettled();
    const after = await fs.lstat(dir, { bigint: true });
    assert.ok(after.isDirectory() && !after.isSymbolicLink() && after.dev === identity.dev && after.ino === identity.ino);
    await fs.rm(dir, { recursive: true, force: false });
  }]) {
    try { await operation(); }
    catch (cleanup) { primary = failed ? addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
  }
}
if (failed) throw primary;
