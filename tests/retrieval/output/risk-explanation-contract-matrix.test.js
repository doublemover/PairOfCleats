#!/usr/bin/env node
import assert from 'node:assert/strict';

import { renderCompositeContextPack } from '../../../src/retrieval/output/composite-context-pack.js';
import { formatScoreBreakdown } from '../../../src/retrieval/output/explain.js';
import {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone,
  buildRiskExplanationPresentationFromRiskSlice,
  buildRiskExplanationPresentationFromStandalone,
  getRiskExplanationSurfaceOptions,
  renderRiskExplain,
  renderRiskExplanation,
  renderRiskExplanationJson
} from '../../../src/retrieval/output/risk-explain.js';
import { renderRiskExplanationSarif } from '../../../src/retrieval/output/risk-sarif.js';
import {
  createCappedRiskSliceInput,
  createFullRiskSliceInput,
  createFullRiskStandaloneInput,
  createMinimalRiskStandaloneInput
} from '../../helpers/risk-explanation-fixtures.js';

const cases = [
  {
    name: 'score breakdown formatting works without color helpers',
    run() {
      const fallbackLines = formatScoreBreakdown({
        selected: { type: 'bm25', score: 1.23 }
      }, {});
      assert.equal(fallbackLines.length, 1);
      assert.match(fallbackLines[0], /Scores/);
    }
  },
  {
    name: 'surface defaults and subject visibility remain stable',
    run() {
      const standaloneDefaults = getRiskExplanationSurfaceOptions('standalone');
      assert.equal(standaloneDefaults.title, 'Risk Explain');
      assert.equal(standaloneDefaults.includeSubject, true);
      assert.equal(standaloneDefaults.includeFilters, true);
      assert.equal(standaloneDefaults.maxFlows, 20);
      assert.equal(standaloneDefaults.maxPartialFlows, 20);
      assert.equal(standaloneDefaults.maxEvidencePerFlow, 20);

      const contextPackDefaults = getRiskExplanationSurfaceOptions('contextPack');
      assert.equal(contextPackDefaults.title, 'Risk');
      assert.equal(contextPackDefaults.includeSubject, false);
      assert.equal(contextPackDefaults.includeAnchor, false);
      assert.equal(contextPackDefaults.includeFilters, true);
      assert.equal(contextPackDefaults.maxFlows, 5);
      assert.equal(contextPackDefaults.maxPartialFlows, 5);
      assert.equal(contextPackDefaults.maxEvidencePerFlow, 3);

      const standalonePresentation = buildRiskExplanationPresentationFromStandalone({
        chunk: { chunkUid: 'chunk-risk', file: 'src/app.ts', name: 'risky', kind: 'function' },
        summary: {
          totals: { sources: 1, sinks: 1, sanitizers: 0, localFlows: 0 },
          signals: { sources: [], sinks: [], sanitizers: [], localFlows: [] }
        },
        stats: {
          status: 'ok',
          counts: { flowsEmitted: 1, partialFlowsEmitted: 0, summariesEmitted: 1, uniqueCallSitesReferenced: 1 },
          capsHit: []
        },
        flows: []
      }, { surface: 'standalone' });
      assert.equal(standalonePresentation.json.subject.chunkUid, 'chunk-risk');
      assert.match(standalonePresentation.markdown, /Risk Explain/);

      const contextPackPresentation = buildRiskExplanationPresentationFromRiskSlice({
        summary: {
          chunkUid: 'chunk-risk',
          file: 'src/app.ts',
          symbol: { name: 'risky', kind: 'function' },
          totals: { sources: 1, sinks: 1, sanitizers: 0, localFlows: 0 }
        },
        analysisStatus: { status: 'ok', code: 'ok' },
        flows: []
      }, {
        surface: 'contextPack',
        subject: { chunkUid: 'chunk-risk', file: 'src/app.ts', name: 'risky', kind: 'function' }
      });
      assert.equal(contextPackPresentation.json.subject.chunkUid, 'chunk-risk');
      assert.equal(contextPackPresentation.json.subject.name, 'risky');
      assert.match(contextPackPresentation.markdown, /^Risk\n/m);
      assert.doesNotMatch(contextPackPresentation.markdown, /- chunkUid:/);
    }
  },
  {
    name: 'standalone and context-pack presentations stay aligned',
    run() {
      const flows = [{
        flowId: 'flow-1',
        confidence: 0.88,
        category: 'injection',
        source: { chunkUid: 'chunk-a', ruleId: 'SRC1', category: 'input' },
        sink: { chunkUid: 'chunk-b', ruleId: 'SNK1', category: 'injection' },
        path: {
          nodes: [
            { type: 'chunk', chunkUid: 'chunk-a' },
            { type: 'chunk', chunkUid: 'chunk-b' }
          ],
          callSiteIdsByStep: [['cs-1', 'cs-2']]
        },
        evidence: {
          callSitesByStep: [[
            { callSiteId: 'cs-1', details: { file: 'src/app.ts' } },
            { callSiteId: 'cs-2', details: { file: 'src/app.ts' } }
          ]]
        }
      }];
      const summary = {
        chunkUid: 'chunk-a',
        file: 'src/app.ts',
        totals: { sources: 1, sinks: 1, sanitizers: 0, localFlows: 0 },
        topCategories: [{ category: 'injection', count: 1 }, { category: 'input', count: 1 }],
        topTags: [{ tag: 'sql', count: 2 }]
      };
      const stats = {
        status: 'ok',
        flowsEmitted: 1,
        summariesEmitted: 1,
        uniqueCallSitesReferenced: 2,
        capsHit: []
      };
      const provenance = {
        generatedAt: '2026-03-12T00:00:00.000Z',
        ruleBundle: { version: '1.0.0', fingerprint: 'sha1:rules' },
        effectiveConfigFingerprint: 'sha1:config',
        artifactRefs: { flows: { entrypoint: 'risk_flows.jsonl' } }
      };
      const standalone = buildRiskExplanationPresentationFromStandalone({
        chunk: { chunkUid: 'chunk-a', file: 'src/app.ts', name: 'risky', kind: 'function' },
        summary: {
          chunkUid: 'chunk-a',
          file: 'src/app.ts',
          totals: { sources: 1, sinks: 1, sanitizers: 0, localFlows: 0 },
          signals: {
            sources: [{ category: 'input', tags: ['sql'] }],
            sinks: [{ category: 'injection', tags: ['sql'] }],
            sanitizers: [],
            localFlows: []
          }
        },
        stats: {
          status: 'ok',
          counts: { flowsEmitted: 1, summariesEmitted: 1, uniqueCallSitesReferenced: 2 },
          capsHit: [],
          provenance
        },
        flows,
        filters: {}
      }, {
        surface: 'standalone',
        title: null,
        includeSubject: false,
        includeFilters: false,
        maxFlows: 1
      });
      const fromPack = buildRiskExplanationPresentationFromRiskSlice({
        summary,
        stats,
        provenance,
        analysisStatus: { status: 'ok', code: 'ok' },
        flows
      }, {
        surface: 'standalone',
        title: null,
        includeSubject: false,
        includeFilters: false,
        maxFlows: 1
      });
      assert.equal(standalone.markdown, fromPack.markdown);
      assert.deepEqual(standalone.json.flows, fromPack.json.flows);
    }
  },
  {
    name: 'context-pack rendering reuses shared risk explain output',
    run() {
      const callSiteDetails = {
        file: 'src/app.js',
        startLine: 27,
        startCol: 5,
        calleeNormalized: 'dangerousSink',
        args: ['req.body']
      };
      const cliFlows = [{
        flowId: 'flow-parity',
        confidence: 0.91,
        category: 'injection',
        source: { ruleId: 'SRC-1' },
        sink: { ruleId: 'SNK-1' },
        path: {
          labels: ['chunk:chunk-a', 'chunk:chunk-b'],
          callSiteIdsByStep: [['cs-1']]
        },
        callSitesByStep: [[{ callSiteId: 'cs-1', details: callSiteDetails }]]
      }];
      const contextPack = {
        primary: {
          ref: { type: 'chunk', chunkUid: 'chunk-a' },
          file: 'src/app.js',
          excerpt: 'dangerousSink(req.body);'
        },
        risk: {
          status: 'ok',
          summary: {
            totals: { sources: 1, sinks: 1, sanitizers: 0, localFlows: 1 }
          },
          flows: [{
            flowId: 'flow-parity',
            confidence: 0.91,
            category: 'injection',
            source: { ruleId: 'SRC-1' },
            sink: { ruleId: 'SNK-1' },
            path: {
              nodes: [
                { type: 'chunk', chunkUid: 'chunk-a' },
                { type: 'chunk', chunkUid: 'chunk-b' }
              ],
              callSiteIdsByStep: [['cs-1']]
            },
            evidence: {
              callSitesByStep: [[{ callSiteId: 'cs-1', details: callSiteDetails }]]
            }
          }]
        }
      };
      const expectedFlowSection = renderRiskExplain(cliFlows, { maxFlows: 1, maxEvidencePerFlow: 3 });
      const expectedRiskSection = buildRiskExplanationPresentationFromRiskSlice(
        contextPack.risk,
        {
          surface: 'contextPack',
          subject: { chunkUid: 'chunk-a', file: 'src/app.js', name: null, kind: null }
        }
      ).markdown;
      const compositeOutput = renderCompositeContextPack(contextPack);
      assert(compositeOutput.includes(expectedFlowSection));
      assert(compositeOutput.includes(expectedRiskSection));
      assert(compositeOutput.includes('src/app.js:27:5 dangerousSink(req.body)'));
    }
  },
  {
    name: 'renderRiskExplain formats path labels and evidence details',
    run() {
      const flows = [{
        flowId: 'flow-1',
        confidence: 0.88,
        category: 'injection',
        source: { ruleId: 'SRC1' },
        sink: { ruleId: 'SNK1' },
        path: {
          nodes: [
            { type: 'chunk', chunkUid: 'chunk-a' },
            { type: 'chunk', chunkUid: 'chunk-b' }
          ],
          callSiteIdsByStep: [['cs-1', 'cs-2']]
        },
        evidence: {
          callSitesByStep: [[{
            callSiteId: 'cs-1',
            details: {
              file: 'src/index.js',
              startLine: 12,
              startCol: 7,
              calleeNormalized: 'sink',
              args: ['req.body'],
              excerpt: 'db.raw(req.body)'
            }
          }]]
        }
      }];
      const output = renderRiskExplain(flows, { maxFlows: 1, maxEvidencePerFlow: 2 });
      assert(output.includes('flow-1'));
      assert(output.includes('chunk:chunk-a'));
      assert(output.includes('src/index.js:12:7 sink(req.body) | db.raw(req.body)'));
    }
  },
  {
    name: 'JSON and markdown contracts stay stable for minimal, full, and capped flows',
    run() {
      const minimalModel = buildRiskExplanationModelFromStandalone(createMinimalRiskStandaloneInput());
      const minimalJson = renderRiskExplanationJson(minimalModel, {
        title: 'Risk Explain',
        maxFlows: 1,
        maxEvidencePerFlow: 2
      });
      assert.deepEqual(minimalJson.flowSelection, {
        totalFlows: 0,
        shownFlows: 0,
        omittedFlows: 0,
        maxFlows: 1,
        maxEvidencePerFlow: 2
      });
      assert.deepEqual(minimalJson.partialFlowSelection, {
        totalPartialFlows: 0,
        shownPartialFlows: 0,
        omittedPartialFlows: 0,
        maxPartialFlows: 3,
        maxEvidencePerFlow: 2
      });
      assert.deepEqual(minimalJson.flows, []);
      assert.deepEqual(minimalJson.partialFlows, []);
      assert.equal(minimalJson.summary?.totals?.sources, 0);
      assert.match(renderRiskExplanation(minimalModel, { maxFlows: 1, maxEvidencePerFlow: 2 }), /Risk Flows\n- \(none\)/);

      const fullModel = buildRiskExplanationModelFromRiskSlice(createFullRiskSliceInput(), {
        subject: { chunkUid: 'chunk-full', file: 'src/full.js', name: 'full', kind: 'function' }
      });
      const fullJson = renderRiskExplanationJson(fullModel, {
        title: 'Risk Explain',
        maxFlows: 3,
        maxPartialFlows: 5,
        maxEvidencePerFlow: 2
      });
      assert.equal(fullJson.flows[0].flowId, 'flow-full');
      assert.equal(fullJson.flows[0].source?.ruleRole, 'source');
      assert.deepEqual(fullJson.flows[0].source?.tags, ['input', 'http']);
      assert.equal(fullJson.flows[0].sink?.ruleRole, 'sink');
      assert.deepEqual(fullJson.flows[0].sink?.tags, ['sql']);
      assert.deepEqual(fullJson.summary?.ruleRoles, { sources: 1, sinks: 1, sanitizers: 0 });
      assert.deepEqual(fullJson.summary?.propagatorLikeRoles, [{ role: 'callback', count: 1 }]);
      assert.equal(fullJson.provenance?.ruleBundle?.roleModel?.propagatorLikeEncoding, 'watch-semantics');
      assert.equal(fullJson.flows[0].steps[0].step, 1);
      assert.deepEqual(fullJson.flows[0].steps[0].evidence, ['src/full.js:18:4 query(req.body)']);
      assert.equal(fullJson.flows[0].steps[0].watchWindow?.calleeNormalized, 'query');
      assert.deepEqual(fullJson.flows[0].steps[0].watchWindow?.boundParams, ['input']);
      assert.deepEqual(fullJson.flows[0].steps[0].watchWindow?.semanticIds, ['sem.callback.register-handler-payload']);
      assert.deepEqual(fullJson.flows[0].steps[0].watchWindow?.semanticKinds, ['callback']);
      assert.deepEqual(fullJson.partialFlows[0].steps[0].watchWindow?.semanticIds, ['sem.callback.register-handler-payload']);
      assert.deepEqual(fullJson.partialFlows[0].steps[0].watchWindow?.semanticKinds, ['callback']);
      assert.equal(fullJson.sarif.runs[0].results[0].partialFingerprints.pairOfCleatsFlowId, 'flow-full');
      assert.equal(
        fullJson.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.artifactLocation.uri,
        'src/full.js'
      );
      assert.equal(
        fullJson.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.calleeNormalized,
        'query'
      );
      assert.equal(fullJson.partialFlowSelection.totalPartialFlows, 1);
      assert.equal(fullJson.partialFlows[0].partialFlowId, 'partial-a');
      assert.equal(fullJson.partialFlows[0].terminalReason, 'maxDepth');
      assert.equal(fullJson.partialFlows[0].frontierChunkUid, 'chunk-mid');
      assert.deepEqual(fullJson.partialFlows[0].steps[0].evidence, ['src/full.js:18:4 query(req.body)']);

      const fullMarkdown = renderRiskExplanation(fullModel, {
        maxFlows: 3,
        maxPartialFlows: 5,
        maxEvidencePerFlow: 2
      });
      assert.match(fullMarkdown, /summary: sources 1, sinks 1, sanitizers 0, localFlows 1/);
      assert.match(fullMarkdown, /interprocedural: status ok, flows 1, partial flows 2, summaries 1, call sites 1/);
      assert.match(fullMarkdown, /pack caps: maxFlows 3, maxPartialFlows 5, maxBytes 512, maxTokens 128, maxPartialBytes 100, maxPartialTokens 50/);
      assert.match(fullMarkdown, /provenance: generated 2026-03-12T00:00:00.000Z, rules 1.0.0 sha1:bundle, config sha1:config/);
      assert.match(fullMarkdown, /step 1: src\/full.js:18:4 query\(req.body\)/);
      assert.match(fullMarkdown, /watch: taint req.body -> input; params input; callee query; semantics sem.callback.register-handler-payload; confidence 0.6000 -> 0.5100/);
      assert.match(fullMarkdown, /Partial Risk Flows/);
      assert.match(fullMarkdown, /partial-a/);

      const cappedModel = buildRiskExplanationModelFromRiskSlice(createCappedRiskSliceInput());
      const cappedJson = renderRiskExplanationJson(cappedModel, {
        title: 'Risk Explain',
        maxFlows: 1,
        maxEvidencePerFlow: 1
      });
      assert.deepEqual(cappedJson.flowSelection, {
        totalFlows: 2,
        shownFlows: 1,
        omittedFlows: 1,
        maxFlows: 1,
        maxEvidencePerFlow: 1
      });
      assert.equal(cappedJson.flows.length, 1);
      assert.equal(cappedJson.sarif.runs[0].properties.pairOfCleats.flowSelection.omittedFlows, 1);
      const cappedMarkdown = renderRiskExplanation(cappedModel, { maxFlows: 1, maxEvidencePerFlow: 1 });
      assert.match(cappedMarkdown, /truncation: maxFlows/);
      assert.match(cappedMarkdown, /omitted 1 additional flow\(s\) after maxFlows=1/);
    }
  },
  {
    name: 'SARIF contract stays stable for minimal, full, and capped flows',
    run() {
      const minimalModel = buildRiskExplanationModelFromStandalone(createMinimalRiskStandaloneInput());
      const minimalSarif = renderRiskExplanationSarif(minimalModel, {
        title: 'Risk Explain',
        maxFlows: 1,
        maxEvidencePerFlow: 2
      });
      assert.equal(minimalSarif.version, '2.1.0');
      assert.equal(minimalSarif.runs[0].results.length, 0);
      assert.deepEqual(minimalSarif.runs[0].properties.pairOfCleats.flowSelection, {
        totalFlows: 0,
        shownFlows: 0,
        omittedFlows: 0,
        maxFlows: 1,
        maxEvidencePerFlow: 2
      });
      assert.deepEqual(minimalSarif.runs[0].properties.pairOfCleats.partialFlowSelection, {
        totalPartialFlows: 0,
        shownPartialFlows: 0,
        omittedPartialFlows: 0,
        maxPartialFlows: 3,
        maxEvidencePerFlow: 2
      });

      const fullModel = buildRiskExplanationModelFromStandalone(createFullRiskStandaloneInput());
      const fullSarif = renderRiskExplanationSarif(fullModel, {
        title: 'Risk Explain',
        maxFlows: 3,
        maxEvidencePerFlow: 2
      });
      assert.equal(fullSarif.runs[0].results.length, 1);
      assert.equal(fullSarif.runs[0].tool.driver.rules.length, 1);
      assert.equal(fullSarif.runs[0].results[0].ruleId, 'pairofcleats/risk-flow');
      assert.equal(fullSarif.runs[0].results[0].properties.pairOfCleats.flowId, 'flow-full');
      assert.equal(fullSarif.runs[0].results[0].properties.pairOfCleats.confidence, 0.91);
      assert.equal(
        fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.artifactLocation.uri,
        'src/full.js'
      );
      assert.equal(
        fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.region.startLine,
        18
      );
      assert.equal(
        fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.calleeNormalized,
        'query'
      );
      assert.deepEqual(
        fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.semanticIds,
        ['sem.callback.register-handler-payload']
      );
      assert.deepEqual(
        fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.semanticKinds,
        ['callback']
      );
      assert.match(fullSarif.runs[0].results[0].message.text, /injection \| SRC -> SNK/);
      assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlowSelection.totalPartialFlows, 1);
      assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].partialFlowId, 'partial-a');
      assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].frontier.chunkUid, 'chunk-mid');
      assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].calleeNormalized, 'query');
      assert.deepEqual(
        fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].semanticIds,
        ['sem.callback.register-handler-payload']
      );
      assert.deepEqual(
        fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].semanticKinds,
        ['callback']
      );

      const cappedModel = buildRiskExplanationModelFromRiskSlice(createCappedRiskSliceInput());
      const cappedSarif = renderRiskExplanationSarif(cappedModel, {
        title: 'Risk Explain',
        maxFlows: 1,
        maxEvidencePerFlow: 1
      });
      assert.equal(cappedSarif.runs[0].results.length, 1);
      assert.deepEqual(cappedSarif.runs[0].properties.pairOfCleats.flowSelection, {
        totalFlows: 2,
        shownFlows: 1,
        omittedFlows: 1,
        maxFlows: 1,
        maxEvidencePerFlow: 1
      });
      assert.deepEqual(cappedSarif.runs[0].properties.pairOfCleats.truncation, cappedModel.truncation);
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('risk explanation contract matrix test passed');
