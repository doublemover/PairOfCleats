import assert from 'node:assert/strict';
import { createRiskWitnessObservation, riskSemanticProjection } from '../../../helpers/risk-witness-observation.js';
import { riskSpineScenario, riskBranchScenario, riskDiamondScenario, riskScenarioInput, riskWitnessCall } from '../../../helpers/risk-witness-scenarios.js';
import { createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk, createRiskSanitizerChunk } from './helpers/risk-flow-fixtures.js';
import { buildCodeRelations } from '../../../../src/lang/javascript/relations.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/risk/interprocedural/witness-representation-parity/')[1];
const modes = ['spine4', 'spine20', 'branch4', 'branch20', 'diamond', 'cycle', 'multiple-roots',
  'tainted', 'untainted', 'spread', 'terminate', 'weaken', 'timeout-frontier', 'cap-matrix', 'escaping-order'];
assert.ok(modes.includes(mode));
const candidate = createRiskWitnessObservation('candidate'), reference = createRiskWitnessObservation('reference');
try {
  const computeCandidate = await candidate.load(), computeReference = await reference.load();
  const run = (compute, probe, input, step = null) => {
    const now = Date.now; let tick = 0;
    if (step !== null) Date.now = () => (tick += step);
    try { return probe.run(() => compute(input)); }
    finally { Date.now = now; }
  };
  const compare = (scenario, step = null) => {
    const input = riskScenarioInput(scenario);
    const snapshot = structuredClone(input.chunks);
    const actual = run(computeCandidate, candidate, input, step);
    const control = run(computeReference, reference, input, step);
    assert.deepEqual(riskSemanticProjection(actual), riskSemanticProjection(control), 'complete content, ordering, caps, watch arrays and references match the independent array representation');
    assert.deepEqual(input.chunks, snapshot, 'neither representation mutates the input graph');
    return actual;
  };
  if (mode.startsWith('spine') || mode.startsWith('branch')) {
    const depth = mode.endsWith('20') ? 20 : 4, width = 16;
    const result = compare(mode.startsWith('spine') ? riskSpineScenario({ depth, width }) : riskBranchScenario({ depth, width }));
    assert.equal(result.flowRows.length, mode.startsWith('spine') ? 1 : width);
    assert.ok(result.flowRows.every(row => row.path.chunkUids.length === depth + 1));
    assert.ok(candidate.metrics.peakIndexEntries <= width + 1, 'completed depth layers cannot accumulate in the witness index');
    assert.equal(candidate.metrics.copiedPrefixSlots, 0);
    assert.ok(reference.metrics.copiedPrefixSlots > 0);
    assert.equal(candidate.metrics.peakRetainedPathSlots, 0);
    assert.ok(candidate.metrics.peakRetainedWitnessNodes <= width + depth + 1,
      'retained witness nodes are bounded by the live frontier and its shared ancestry');
    assert.ok(candidate.metrics.reusedParentLinks > 0, 'branches share the original parent node');
    assert.ok(reference.metrics.peakRetainedPathSlots > 0);
    assert.ok(candidate.metrics.peakOwnedQueueSlots <= width + 1, 'only active frontier slots remain queue-owned');
    assert.ok(reference.metrics.peakOwnedQueueSlots > candidate.metrics.peakOwnedQueueSlots);
    assert.equal(candidate.metrics.materializations, result.flowRows.length, 'full arrays are created at accepted output emission');
  } else if (['tainted', 'untainted', 'spread'].includes(mode)) {
    const args = { tainted: '0,0,0,0,0,req.body', untainted: '0,0,0,0,0,1', spread: '...values,req.body' }[mode];
    const relations = buildCodeRelations(`function source(req,values){sink(${args});} function sink(a,b,c,d,e,value){}`, 'source.js');
    const source = createRiskSourceChunk(), sink = createRiskSinkChunk();
    source.codeRelations.callDetails = relations.callDetails.filter(row => row.callee === 'sink')
      .map(row => ({ ...row, targetChunkUid: sink.chunkUid }));
    sink.docmeta.callableParameters = relations.functionMeta.sink.callableParameters;
    sink.docmeta.paramNames = relations.functionMeta.sink.paramNames;
    const result = compare({ chunks: [source, sink], runtime: createRiskRuntime({ strictness: 'argAware',
      caps: { maxPartialFlows: 10, maxBlockedExpansionsPerPartial: 10 },
      sourceRules: [{ id: 'source.req.body', patterns: [/req\.body/i] }] }) });
    assert.equal(result.flowRows.length, mode === 'tainted' ? 1 : 0);
    if (mode !== 'tainted') assert.ok(JSON.stringify(result.partialFlowRows).includes(mode === 'spread' ? 'incompleteArgumentEvidence' : 'untaintedArgs'));
  } else if (mode === 'terminate' || mode === 'weaken') {
    const result = compare({ chunks: [createRiskSourceChunk({ callee: 'sanitize', targetChunkUid: 'uid-sanitize' }),
      createRiskSanitizerChunk(), createRiskSinkChunk()], runtime: createRiskRuntime({ sanitizerPolicy: mode,
      caps: { maxPartialFlows: 10, maxBlockedExpansionsPerPartial: 10 } }) });
    assert.equal(result.flowRows.length, mode === 'weaken' ? 1 : 0);
    if (mode === 'weaken') assert.equal(result.flowRows[0].notes.sanitizerBarriersHit, 1);
  } else {
    const scenario = riskDiamondScenario();
    if (mode === 'cycle') scenario.chunks.find(row => row.chunkUid === 'join').codeRelations.callDetails.push(riskWitnessCall('left', 8));
    if (mode === 'multiple-roots') {
      const other = structuredClone(scenario.chunks[0]); other.chunkUid = 'uid-source-b'; other.file = 'source-b.js';
      scenario.chunks.push(other);
      const rule = structuredClone(scenario.chunks[0].docmeta.risk.sources[0]); rule.id += '.second';
      scenario.chunks[0].docmeta.risk.sources.push(rule);
    }
    if (mode === 'escaping-order') {
      const names = ['a"', 'a\\', 'a\n', 'ab'];
      const template = scenario.chunks.find(row => row.chunkUid === 'left');
      scenario.chunks[0].codeRelations.callDetails = names.map((id, i) => riskWitnessCall(id, i + 1));
      scenario.chunks.push(...names.map(id => ({ ...structuredClone(template), chunkUid: id, file: `${id}.js` })));
      scenario.runtime.riskInterproceduralConfig.caps.maxPathsPerPair = 3;
    }
    if (mode === 'timeout-frontier') {
      scenario.runtime.riskInterproceduralConfig.caps.maxMs = 5;
      const result = compare(scenario, 2); assert.equal(result.status, 'timed_out');
      assert.ok(result.partialFlowRows.length > 0);
    } else if (mode === 'cap-matrix') {
      for (const caps of [{ maxTotalFlows: 0 }, { maxTotalFlows: 1 }, { maxPathsPerPair: 1 },
        { maxPartialFlows: 0, maxDepth: 1 }, { maxPartialFlows: 1, maxDepth: 1 },
        { maxEdgeExpansions: 1 }, { maxEdgeExpansions: 3 }, { maxCallSitesPerEdge: 1 }]) {
        const variant = { ...scenario, runtime: structuredClone(scenario.runtime) };
        Object.assign(variant.runtime.riskInterproceduralConfig.caps, caps);
        compare(variant);
      }
      const sampled = riskDiamondScenario();
      sampled.chunks[0].codeRelations.callDetails.push(riskWitnessCall('left', 10), riskWitnessCall('left', 11));
      sampled.runtime.riskInterproceduralConfig.caps.maxCallSitesPerEdge = 1;
      const sampledResult = compare(sampled);
      assert.ok(sampledResult.flowRows.length > 0);
      assert.ok(sampledResult.flowRows.every(row => row.path.callSiteIdsByStep.every(ids => ids.length === 1)));
      for (const limit of [0, 1]) {
        const blocked = riskDiamondScenario();
        blocked.runtime.riskInterproceduralConfig.strictness = 'argAware';
        blocked.runtime.riskInterproceduralConfig.caps.maxBlockedExpansionsPerPartial = limit;
        const result = compare(blocked);
        const sourcePartial = result.partialFlowRows.find(row => row.frontier.chunkUid === 'uid-source');
        assert.ok(sourcePartial);
        assert.equal(sourcePartial.frontier.blockedExpansions.length, limit);
      }
    } else {
      const result = compare(scenario);
      assert.equal(result.flowRows.length, mode === 'multiple-roots' ? 6 : mode === 'escaping-order' ? 3 : 2);
      assert.equal(new Set(result.flowRows.map(row => row.flowId)).size, result.flowRows.length);
      if (mode === 'cycle') assert.ok(result.stats.capsHit.includes('maxDepth'));
      const reversed = compare({ ...scenario, chunks: [...scenario.chunks].reverse() });
      assert.deepEqual({ flows: reversed.flowRows, partials: reversed.partialFlowRows, refs: [...reversed.callSiteIdsReferenced] },
        { flows: result.flowRows, partials: result.partialFlowRows, refs: [...result.callSiteIdsReferenced] },
        'input order preserves all retained flow witnesses, frontier rows and referenced call IDs');
    }
  }
  console.log(JSON.stringify({ mode, candidate: candidate.metrics, reference: reference.metrics }));
} finally { candidate.dispose(); reference.dispose(); }
