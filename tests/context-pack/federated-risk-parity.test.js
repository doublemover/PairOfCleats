#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import {
  buildRiskCallSite,
  buildRiskFlow,
  buildRiskPiecesManifestFields,
  buildRiskStatsFields,
  buildRiskSummary,
  createRiskRepoIndexFixture,
  findRiskQueryOffset,
  writeJsonl
} from '../helpers/risk-pack-eval.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { handleToolCall } from '../../tools/mcp/tools.js';
import { writeFederatedWorkspaceConfig, startFederatedApiServer } from '../helpers/federated-api.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { federatedRiskProjectionErrors } from '../../src/context-pack/federated-risk.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { renderCompositeContextPack, renderCompositeContextPackJson } from '../../src/retrieval/output/composite-context-pack.js';
import { renderCompositeContextPackSarif } from '../../src/retrieval/output/risk-sarif.js';
import { buildRiskExplanationPresentationFromRiskSlice } from '../../src/retrieval/output/risk-explain.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../../src/context-pack/response-budget.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-federated-risk');
const cacheRoot = path.join(tempRoot, 'cache');
applyTestEnv({ cacheRoot });
const workspaceDir = path.join(tempRoot, 'workspace');
const workspacePath = path.join(workspaceDir, '.pairofcleats-workspace.jsonc');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const riskSeed = 'chunk:chunk-risk';
const federatedRiskGeneratedAt = '2026-03-19T12:00:00.000Z';
const federatedRiskCompatibilityKey = 'compat-federated-risk';

const buildRiskRepo = async (repoPath, alias, priority) => {
  const sourceText = `export function ${alias}Risk(input) {\n  return query(input);\n}\n`;
  const fileRelPath = `src/${alias}.js`;
  const { finalIndexDir } = await createRiskRepoIndexFixture({
    repoPath,
    cacheRoot,
    fileRelPath,
    sourceText,
    alias,
    generatedAt: federatedRiskGeneratedAt,
    compatibilityKey: federatedRiskCompatibilityKey
  });

  const queryOffset = findRiskQueryOffset(sourceText);
  const flowId = `sha1:${alias[0].repeat(40)}`;

  const stats = buildRiskStatsFields({
    generatedAt: federatedRiskGeneratedAt,
    flowsEmitted: 1,
    uniqueCallSitesReferenced: 1,
    maxCallSitesPerEdge: 1
  });
  stats.fields.provenance = { effectiveConfigFingerprint: 'config-' + alias,
    ruleBundle: { version: '1.0.0', fingerprint: 'rules-' + alias, provenance: { defaults: true } } };
  await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'), stats);
  await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [buildRiskSummary({
    fileRelPath,
    languageId: 'javascript',
    symbolName: `${alias}Risk`,
    symbolKind: 'FunctionDeclaration',
    signature: `${alias}Risk(input)`
  })]);
  await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), [buildRiskFlow({
    alias,
    flowId,
    confidence: priority >= 10 ? 0.95 : 0.85
  })]);
  await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), [buildRiskCallSite({
    callSiteId: `cs-${alias}`,
    fileRelPath,
    languageId: 'javascript',
    queryOffset
  })]);
  await writeJsonObjectFile(path.join(finalIndexDir, 'pieces', 'manifest.json'), buildRiskPiecesManifestFields({
    compatibilityKey: federatedRiskCompatibilityKey,
    generatedAt: federatedRiskGeneratedAt,
    stage: 'context-pack-federated-risk-test'
  }));

  return {
    repoPath,
    alias,
    flowId,
    finalIndexDir,
    stats
  };
};

const normalizeRiskProjection = (payload) => ({
  selectedRepos: payload?.risk?.federation?.selection?.selectedRepos?.map((repo) => repo.alias) || [],
  skippedRepos: payload?.risk?.federation?.skippedRepos?.map((repo) => repo.alias) || [],
  flows: Array.isArray(payload?.risk?.flows)
    ? payload.risk.flows.map((flow) => ({
      flowId: flow.flowId,
      repoAlias: flow.repo?.alias || null,
      sourceAlias: flow.source?.repo?.alias || null,
      sinkAlias: flow.sink?.repo?.alias || null,
      nodeAliases: Array.isArray(flow.path?.nodes) ? flow.path.nodes.map((node) => node.repo?.alias || null) : [],
      evidenceAliases: Array.isArray(flow.evidence?.callSitesByStep)
        ? flow.evidence.callSitesByStep.flat().map((entry) => entry?.details?.repo?.alias || null)
        : []
    }))
    : []
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(workspaceDir, { recursive: true });
await buildRiskRepo(repoA, 'alpha', 10);
const beta = await buildRiskRepo(repoB, 'beta', 5);
await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot,
  repos: [
    { root: repoA, alias: 'alpha', priority: 10, tags: ['team-a'] },
    { root: repoB, alias: 'beta', priority: 5, tags: ['team-b'] }
  ]
});
const workspaceConfig = loadWorkspaceConfig(workspacePath);
const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot: repoA,
  allowedRoots: [tempRoot],
  envOverrides: process.env
});
const assertAttestations = (payload, { betaConfig = 'config-beta', betaRules = 'rules-beta' } = {}) => {
  assert.deepEqual(federatedRiskProjectionErrors(payload), []);
  assert.equal(payload.risk.provenance, null); assert.equal(payload.risk.support, null);
  assert.equal(payload.risk.stats, null); assert.equal(payload.risk.caps, null);
  const members = new Map(payload.risk.federation.attestations.map(member => [member.repoId, member]));
  for (const selected of payload.risk.federation.selection.selectedRepos) {
    const member = members.get(selected.repoId); assert.ok(member);
    assert.equal(member.provenance.effectiveConfigFingerprint, selected.alias === 'beta' ? betaConfig : 'config-alpha');
    assert.equal(member.provenance.ruleBundle.fingerprint, selected.alias === 'beta' ? betaRules : 'rules-alpha');
    for (const flow of payload.risk.flows.filter(value => value.repo.repoId === selected.repoId)) {
      assert.equal(flow.repo.attestationId, member.attestationId);
      for (const node of [flow.source, flow.sink, ...flow.path.nodes,
        ...flow.evidence.callSitesByStep.flat().map(site => site.details)].filter(Boolean)) {
        assert.equal(node.repo.attestationId, member.attestationId);
      }
    }
  }
  return payload.risk.federation.attestations;
};
try {
  const baseArgs = {
    repoPath: repoA,
    workspacePath,
    workspaceId: workspaceConfig.repoSetId,
    seed: riskSeed,
    hops: 0,
    includeRisk: true,
    includeGraph: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false
  };

  const singleRepoArgs = {
    ...baseArgs,
    select: {
      repoFilter: ['alpha']
    }
  };
  const singleDirect = await buildCompositeContextPackPayload(singleRepoArgs);
  assert.deepEqual(normalizeRiskProjection(singleDirect), {
    selectedRepos: ['alpha'],
    skippedRepos: [],
    flows: [{
      flowId: `sha1:${'a'.repeat(40)}`,
      repoAlias: 'alpha',
      sourceAlias: 'alpha',
      sinkAlias: 'alpha',
      nodeAliases: ['alpha', 'alpha'],
      evidenceAliases: ['alpha']
    }]
  });

  const singleApi = await requestJson('POST', '/analysis/context-pack', singleRepoArgs, serverInfo);
  assert.equal(singleApi.status, 200, 'expected single-repo federated API request to succeed');
  assert.deepEqual(normalizeRiskProjection(singleApi.body?.result), normalizeRiskProjection(singleDirect));

  const singleMcp = await handleToolCall('context_pack', singleRepoArgs);
  assert.deepEqual(normalizeRiskProjection(singleMcp), normalizeRiskProjection(singleDirect));

  const multiRepoArgs = {
    ...baseArgs,
    maxFederatedRepos: 2
  };
  const multiDirect = await buildCompositeContextPackPayload(multiRepoArgs);
  const originalMembers = assertAttestations(multiDirect);
  const rendered = renderCompositeContextPackJson(multiDirect);
  assert.ok(Buffer.byteLength(JSON.stringify(rendered, null, 2)) + 1 <= CONTEXT_PACK_RESPONSE_MAX_BYTES);
  const riskRendering = buildRiskExplanationPresentationFromRiskSlice(multiDirect.risk, { surface: 'contextPack', format: 'json' }).json;
  if (rendered.risk === null) {
    const budget = rendered.warnings.find(entry => entry.code === 'CONTEXT_PACK_RESPONSE_BUDGET');
    assert.ok(budget.originalBytes > CONTEXT_PACK_RESPONSE_MAX_BYTES);
    assert.deepEqual(budget.omitted, ['risk']);
    assert.equal(rendered.rendered.risk, null);
    assert.throws(() => renderCompositeContextPackJson(multiDirect, { strictRisk: true }), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
  } else {
    assert.deepEqual(rendered.rendered.risk, riskRendering);
  }
  const singleRendered = renderCompositeContextPackJson(singleDirect, { strictRisk: true });
  assert.deepEqual(singleRendered.rendered.risk.federation.attestations, assertAttestations(singleDirect),
    'an admitted complete JSON response preserves actual member attestations');
  assert.deepEqual(riskRendering.federation.attestations, originalMembers);
  for (const flow of riskRendering.flows) {
    const member = originalMembers.find(value => value.repoId === flow.repo.repoId);
    assert.equal(flow.repo.attestationId, member.attestationId);
    for (const step of flow.steps) assert.equal(step.repo.attestationId, member.attestationId);
  }
  const markdown = renderCompositeContextPack(multiDirect);
  const sarif = renderCompositeContextPackSarif(multiDirect);
  assert.deepEqual(sarif.runs[0].properties.pairOfCleats.federation.attestations, originalMembers);
  for (const member of originalMembers) assert.ok(markdown.includes(member.attestationId));
  for (const result of sarif.runs[0].results) {
    const owner = result.properties.pairOfCleats.repo;
    assert.ok(originalMembers.some(member => member.attestationId === owner.attestationId && member.repoId === owner.repoId));
    for (const location of result.codeFlows[0].threadFlows[0].locations) {
      assert.equal(location.properties.pairOfCleats.repo.attestationId, owner.attestationId);
    }
    for (const location of result.locations) assert.equal(location.properties.pairOfCleats.repo.attestationId, owner.attestationId);
  }
  for (const mutate of [value => { value.risk.federation.attestations.pop(); },
    value => { value.risk.flows[1].source.repo = value.risk.flows[0].repo; },
    value => { value.risk.federation.attestations[1].provenance.effectiveConfigFingerprint = 'substituted'; }]) {
    const invalid = structuredClone(multiDirect); mutate(invalid);
    assert.equal(validateCompositeContextPack(invalid).ok, false);
  }
  assert.deepEqual(normalizeRiskProjection(multiDirect), {
    selectedRepos: ['alpha', 'beta'],
    skippedRepos: [],
    flows: [
      {
        flowId: `sha1:${'a'.repeat(40)}`,
        repoAlias: 'alpha',
        sourceAlias: 'alpha',
        sinkAlias: 'alpha',
        nodeAliases: ['alpha', 'alpha'],
        evidenceAliases: ['alpha']
      },
      {
        flowId: `sha1:${'b'.repeat(40)}`,
        repoAlias: 'beta',
        sourceAlias: 'beta',
        sinkAlias: 'beta',
        nodeAliases: ['beta', 'beta'],
        evidenceAliases: ['beta']
      }
    ]
  });

  const multiApi = await requestJson('POST', '/analysis/context-pack', multiRepoArgs, serverInfo);
  assert.equal(multiApi.status, 200, 'expected multi-repo federated API request to succeed');
  assert.deepEqual(normalizeRiskProjection(multiApi.body?.result), normalizeRiskProjection(multiDirect));
  assert.deepEqual(assertAttestations(multiApi.body.result), originalMembers);

  const multiMcp = await handleToolCall('context_pack', multiRepoArgs);
  assert.deepEqual(normalizeRiskProjection(multiMcp), normalizeRiskProjection(multiDirect));
  assert.deepEqual(assertAttestations(multiMcp), originalMembers);
  beta.stats.fields.provenance.effectiveConfigFingerprint = 'config-beta-new';
  beta.stats.fields.provenance.ruleBundle.fingerprint = 'rules-beta-new';
  await writeJsonObjectFile(path.join(beta.finalIndexDir, 'risk_interprocedural_stats.json'), beta.stats);
  const changed = await buildCompositeContextPackPayload(multiRepoArgs);
  const changedExpectations = { betaConfig: 'config-beta-new', betaRules: 'rules-beta-new' };
  assertAttestations(changed, changedExpectations);
  const alphaId = payload => payload.risk.federation.attestations.find(member => member.repoId === originalMembers[0].repoId).attestationId;
  assert.equal(alphaId(changed), alphaId(multiDirect));
  const betaMember = payload => payload.risk.federation.attestations.find(member => member.repoId !== originalMembers[0].repoId);
  assert.notEqual(betaMember(changed).attestationId, betaMember(multiDirect).attestationId);
  assert.equal(betaMember(changed).provenance.effectiveConfigFingerprint, 'config-beta-new');
  const changedApi = await requestJson('POST', '/analysis/context-pack', multiRepoArgs, serverInfo);
  assert.equal(changedApi.status, 200);
  const changedMcp = await handleToolCall('context_pack', multiRepoArgs);
  for (const value of [changedApi.body.result, changedMcp]) {
    assert.deepEqual(assertAttestations(value, changedExpectations), changed.risk.federation.attestations);
    assert.equal(alphaId(value), alphaId(multiDirect));
    assert.equal(betaMember(value).attestationId, betaMember(changed).attestationId);
  }
  const swapped = await buildCompositeContextPackPayload({ ...multiRepoArgs, repoRoot: repoB });
  assertAttestations(swapped, changedExpectations);
  assert.equal(betaMember(swapped).attestationId, betaMember(changed).attestationId, 'changing base cannot rewrite the same member qualification');
  const swappedArgs = { ...multiRepoArgs, repoPath: repoB };
  const swappedApi = await requestJson('POST', '/analysis/context-pack', swappedArgs, serverInfo);
  assert.equal(swappedApi.status, 200);
  const swappedMcp = await handleToolCall('context_pack', swappedArgs);
  for (const value of [swappedApi.body.result, swappedMcp]) {
    assertAttestations(value, changedExpectations);
    assert.equal(betaMember(value).attestationId, betaMember(changed).attestationId);
    assert.equal(alphaId(value), alphaId(multiDirect));
  }
  beta.stats.fields.inputCoverage.status = 'partial';
  await writeJsonObjectFile(path.join(beta.finalIndexDir, 'risk_interprocedural_stats.json'), beta.stats);
  const cappedDirect = await buildCompositeContextPackPayload(multiRepoArgs);
  assert.equal(betaMember(cappedDirect).analysisStatus.code, 'capped');
  assert.equal(cappedDirect.risk.analysisStatus.code, 'capped'); assert.equal(cappedDirect.risk.analysisStatus.strictFailure, true);
  assert.equal(cappedDirect.risk.degraded, false, 'capped completion remains distinct from artifact degradation');
  const cappedApi = await requestJson('POST', '/analysis/context-pack', multiRepoArgs, serverInfo);
  const cappedMcp = await handleToolCall('context_pack', multiRepoArgs);
  for (const value of [cappedApi.body.result, cappedMcp]) {
    assertAttestations(value, changedExpectations);
    assert.deepEqual(federatedRiskProjectionErrors(value), []);
    assert.equal(value.risk.analysisStatus.code, 'capped'); assert.equal(value.risk.analysisStatus.strictFailure, true);
    assert.deepEqual(value.risk.federation.attestations, cappedDirect.risk.federation.attestations);
  }
  const flowsPath = path.join(beta.finalIndexDir, 'risk_flows.jsonl');
  const heldFlowsPath = path.join(beta.finalIndexDir, 'held-risk-flows.jsonl');
  await fs.rename(flowsPath, heldFlowsPath);
  try {
    const missingDirect = await buildCompositeContextPackPayload(multiRepoArgs);
    assert.equal(betaMember(missingDirect).analysisStatus.code, 'missing');
    assert.equal(betaMember(missingDirect).analysisStatus.artifactStatus.flows, 'missing');
    assert.equal(missingDirect.risk.analysisStatus.code, 'missing');
    assert.equal(missingDirect.risk.analysisStatus.strictFailure, true);
    assert.equal(missingDirect.risk.degraded, true);
    assert.ok(missingDirect.warnings.some(warning => warning.code === 'RISK_FLOWS_MISSING'));
    assert.equal(missingDirect.risk.flows.some(flow => flow.repo.alias === 'beta'), false);
    const missingApi = await requestJson('POST', '/analysis/context-pack', multiRepoArgs, serverInfo);
    assert.equal(missingApi.status, 200);
    const missingMcp = await handleToolCall('context_pack', multiRepoArgs);
    for (const value of [missingApi.body.result, missingMcp]) {
      assert.deepEqual(federatedRiskProjectionErrors(value), []);
      assert.deepEqual(value.risk.analysisStatus, missingDirect.risk.analysisStatus);
      assert.deepEqual(value.risk.federation.attestations, missingDirect.risk.federation.attestations);
    }
    await assert.rejects(buildCompositeContextPackPayload({ ...multiRepoArgs, strictRisk: true }),
      { code: 'ERR_CONTEXT_PACK_RISK_STRICT' });
  } finally {
    await fs.rename(heldFlowsPath, flowsPath);
  }
} finally {
  await stop();
}

console.log('context pack federated risk parity test passed');
