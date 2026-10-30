import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { runBakeoffBuildChild, runBakeoffJsonChild } from '../../../tools/bench/embeddings/bakeoff-phase.js';
import { buildRetrievalMetadata } from '../../../src/retrieval/output/retrieval-metadata.js';
import { createRetrievalExecutionOutcome } from '../../../src/retrieval/pipeline/execution-outcome.js';
import { createRetrievalEvidenceRegistry } from '../../../tools/shared/retrieval-execution-evidence.js';
import { createEvaluationDepthPlan } from '../../../tools/eval/depth-plan.js';
import { resolveMatchMode } from '../../../tools/eval/match.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';

if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('Controlled bakeoff receipts require the test environment.');
const controlPath = fileURLToPath(new URL(new URL(import.meta.url).searchParams.get('control')));
const control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
const entry = new URL('../../../tools/bench/embeddings/model-bakeoff.js', import.meta.url).href;
const phase = new URL('../../../tools/bench/embeddings/bakeoff-phase.js', import.meta.url).href;
const planScript = fileURLToPath(new URL('../../../tools/eval/plan.js', import.meta.url));
const jsonChild = fileURLToPath(new URL('./bakeoff-json-report.js', import.meta.url));
const pendingChild = fileURLToPath(new URL('../bakeoff-phase/child.js', import.meta.url));
const pointerPath = path.join(control.repoCacheRoot, 'builds/current.json');
const readCount = () => { try { return Number(fs.readFileSync(control.counter, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } };
const pointer = id => ({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: id,
  buildRoot: `builds/${id}`, buildRootsByMode: { code: `builds/${id}` } });
globalThis[Symbol.for('poc.bakeoff.observed-resume')] = {
  async build(options) {
    const release = path.join(path.dirname(controlPath), 'build.release');
    return runBakeoffBuildChild({ ...options, args: [pendingChild, 'pending', release], onProgress(chunk) {
      options.onProgress?.(chunk);
      if (control.mutation === 'dataset-held' && String(chunk).includes('fixture child ready')) {
        fs.writeFileSync(control.dataset, JSON.stringify(control.changedDataset));
        fs.writeFileSync(control.heldMarker, 'dataset replaced while the original child remained pending');
      }
      fs.writeFileSync(release, 'release original inert child');
    } });
  },
  async json(options) {
    if (!options.args[0].replace(/\\/gu, '/').endsWith('/tools/eval/run.js')) return runBakeoffJsonChild(options);
    const admitted = await runBakeoffJsonChild({ ...options, args: [planScript, ...options.args.slice(1)] });
    const selected = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    const root = path.join(control.repoCacheRoot, selected.buildRootsByMode.code);
    const dataset = JSON.parse(fs.readFileSync(control.dataset, 'utf8'));
    const metricPlan = createEvaluationDepthPlan(Number(options.args[options.args.indexOf('--top') + 1]), resolveMatchMode(undefined));
    if (metricPlan.key !== admitted.evaluationInput.metricPlanKey) throw new Error('Independent inert metric plan does not match the actual selected depth.');
    const metadata = buildRetrievalMetadata({ backendLabel: 'memory',
      effectivePlanIdentity: 'eqp1-' + 'a'.repeat(64), effectiveSystemIdentity: admitted.evaluationSearchPlan.systems.code,
      backendPolicyInfo: { requested: 'memory', reason: 'selected-by-policy' }, cacheInfo: { hit: false, strategy: 'disk-first', memoryHotPath: false },
      idxCode: { state: { buildId: selected.buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, profile: { id: 'fixture-default' } } },
      indexSignaturePayload: { modes: { code: 'independent-fixture-signature' }, generationByMode: { code: {
        buildId: selected.buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generationKey: selected.buildId, activeBuildRoot: root } } },
      executionOutcomes: { code: createRetrievalExecutionOutcome({ mode: 'code', requestedSparse: 'js-bm25', effectiveSparse: 'bm25', annRequested: false }) } });
    const registry = createRetrievalEvidenceRegistry();
    registry.observe({ code: [{ file: 'src/a.js', chunkUid: 'inert:a', start: 0, end: 1 }], retrieval: metadata }, ['code']);
    const score = dataset[0].relevant[0].file === 'src/a.js' ? 1 : 0;
    const report = { schemaVersion: 3, kind: 'live-judged-evaluation',
      fixtureScope: 'independently-specified-inert-receipts;no-native-model-or-retrieval-quality-claim',
      ...admitted, evaluationPlan: metricPlan, executionEvidence: registry.snapshot(),
      summary: { evaluationPlan: metricPlan, cases: 1, mrr: score,
        recallAtK: Object.fromEntries(metricPlan.cutoffs.map(k => [k, score])), ndcgAtK: Object.fromEntries(metricPlan.cutoffs.map(k => [k, score])) } };
    const count = readCount() + 1; fs.writeFileSync(control.counter, String(count));
    const file = path.join(path.dirname(controlPath), `eval-${count}.json`);
    fs.writeFileSync(file, JSON.stringify(report), { flag: 'wx' });
    const returned = await runBakeoffJsonChild({ ...options, args: [jsonChild, file] });
    if (control.mutation === 'publication' && !fs.existsSync(control.publishedMarker)) {
      await atomicWriteJson(pointerPath, pointer('generation-b'));
      fs.writeFileSync(control.publishedMarker, 'B published after A child returned, before controller checkpoint identity');
    }
    return returned;
  }
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === entry && specifier === './bakeoff-phase.js') return { url: 'observed-resume:phase', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'observed-resume:phase') return { format: 'module', shortCircuit: true, source:
    `export * from ${JSON.stringify(phase)};
    const fixture=globalThis[Symbol.for('poc.bakeoff.observed-resume')];
    export const runBakeoffBuildChild=options=>fixture.build(options);
    export const runBakeoffJsonChild=options=>fixture.json(options);` };
  return next(url, context);
} });
