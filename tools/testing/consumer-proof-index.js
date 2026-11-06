#!/usr/bin/env node
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { createGovernanceSnapshot } from '../../tests/runner/governance-snapshot.js';
import { loadConsolidationOwnership } from '../../tests/runner/consolidation-ownership.js';
import { assignLaneWithReason } from '../../tests/runner/run-discovery.js';
import { normalizeShippedSurfaces, SHIPPED_SURFACES_REGISTRY_PATH } from '../release/surfaces.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_CONSUMER_PROOF_INDEX' });
const MAX_FILES = 12000, MAX_BYTES = 64 * 1024 * 1024;

/** Project existing registries only. A declaration is never an execution or
 * semantic-completeness receipt, and range coverage is not a consumer proof.
 * No test, scanner, subprocess, release step or native owner is executed here.
 */
export const buildConsumerProofIndex = async ({ root = process.cwd(), snapshot = null } = {}) => {
  const governance = snapshot || await createGovernanceSnapshot({ root });
  governance.assertRoot(root);
  if (governance.discovered.length > 32768) throw invalid('Proof case admission exhausted.');
  const resolvedRoot = path.resolve(root), files = new Map();
  const engineRoot = fileURLToPath(new URL('../../', import.meta.url)), engineSources = [];
  for (const sourcePath of ['tools/testing/consumer-proof-index.js', 'tools/release/surfaces.js',
    'tests/runner/governance-snapshot.js', 'tests/runner/run-config.js', 'tests/runner/run-discovery.js',
    'tests/runner/case-inventory.js', 'tests/runner/lane-manifests.js', 'tests/runner/consolidation-ownership.js']) {
    const source = await readVerifiedContainedFile(engineRoot, path.join(engineRoot, sourcePath), { maxBytes: 2 * 1024 * 1024 });
    engineSources.push({ path: sourcePath, hash: source.hash });
  }
  const projectionIdentity = { version: 1, sources: engineSources,
    digest: hash(JSON.stringify(engineSources)), scope: 'projector-and-registry-adapters' };
  let readBytes = 0;
  const relative = absolute => {
    const value = path.relative(resolvedRoot, absolute).split(path.sep).join('/');
    if (!value || value.startsWith('../') || path.isAbsolute(value)) throw invalid('Proof input is outside its source root.');
    return value;
  };
  const read = async filename => {
    const absolute = path.resolve(resolvedRoot, filename), key = relative(absolute);
    if (!files.has(key)) {
      if (files.size >= MAX_FILES) throw invalid('Proof source-file admission exhausted.');
      const opened = await readVerifiedContainedFile(resolvedRoot, absolute, { maxBytes: Math.min(2 * 1024 * 1024, MAX_BYTES - readBytes) });
      readBytes += opened.buffer.length;
      files.set(key, { path: key, hash: opened.hash, physicalIdentity: opened.fileIdentity, bytes: opened.buffer.length,
        text: opened.buffer.toString('utf8') });
    }
    return files.get(key);
  };
  const readText = async filename => (await read(filename)).text;
  const registry = await read(SHIPPED_SURFACES_REGISTRY_PATH);
  // Canonical surface normalization remains the packaging owner's job; parse
  // exactly the contained bytes represented by this report's manifest digest.
  const shipped = normalizeShippedSurfaces(resolvedRoot, JSON.parse(registry.text));
  const ownership = await loadConsolidationOwnership({ root: resolvedRoot, readText });
  const lanes = new Map();
  await read('tests/run.rules.jsonc');
  await read('tests/runner/lane-manifests.jsonc');
  for (const [lane, config] of governance.laneConfig.orderedLanes) {
    const order = await read(config.orderFilePath), manifest = await read(config.manifestPath);
    const ids = order.text.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (new Set(ids).size !== ids.length) throw invalid(`Duplicate case in ${lane} order.`);
    const canonical = await governance.manifest(lane);
    if (JSON.stringify(JSON.parse(manifest.text).tests) !== JSON.stringify(canonical.tests)) throw invalid(`Changed ${lane} manifest.`);
    const declaredIds = canonical.tests.map(test => test.id);
    if (JSON.stringify(ids) !== JSON.stringify(declaredIds)) throw invalid(`Order/manifest mismatch for ${lane}.`);
    for (const id of ids) { if (!lanes.has(id)) lanes.set(id, []); lanes.get(id).push(lane); }
  }
  const byCase = new Map(), bySuite = new Map(), inventories = new Map(), cases = [];
  for (const test of governance.discovered) {
    if (byCase.has(test.id)) throw invalid(`Duplicate discovered case: ${test.id}`);
    const source = await read(test.path);
    if (test.caseId && !inventories.has(test.sourceId)) {
      const inventory = JSON.parse(await readText(test.path + '.cases.json'));
      if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.cases)) throw invalid(`Changed case inventory: ${test.sourceId}`);
      inventories.set(test.sourceId, inventory.cases.map(caseId => test.sourceId + '/' + caseId));
    }
    const row = { caseId: test.id, sourcePath: source.path, sourceHash: source.hash,
      sourcePathIdentity: { path: source.path, ...source.physicalIdentity },
      orderedLanes: (lanes.get(test.id) || []).sort(compare),
      intrinsicLane: assignLaneWithReason(test.id, governance.runRules.laneRules).lane, executionStatus: 'unobserved',
      processBoundary: 'fresh-node-process' };
    cases.push(row); byCase.set(test.id, row);
    const suiteId = test.sourceId || test.id;
    if (!bySuite.has(suiteId)) bySuite.set(suiteId, []);
    bySuite.get(suiteId).push(test.id);
  }
  for (const [sourceId, declared] of inventories) {
    if (JSON.stringify(declared) !== JSON.stringify(bySuite.get(sourceId))) throw invalid(`Changed case inventory: ${sourceId}`);
  }
  for (const id of lanes.keys()) if (!byCase.has(id)) throw invalid(`Lane references an undiscovered case: ${id}`);
  const witnesses = [];
  for (const declared of ownership.payload.consumerWitnesses) {
    if (!byCase.has(declared.caseId) || declared.negativeCaseIds.some(id => !byCase.has(id))) {
      throw invalid(`Consumer witness references an undiscovered case: ${declared.caseId}`);
    }
    const sources = [];
    for (const sourcePath of declared.sourcePaths) {
      const source = await read(sourcePath);
      sources.push({ path: source.path, hash: source.hash, physicalIdentity: source.physicalIdentity });
    }
    witnesses.push({ ...declared, sources, status: 'declared-only', observedScope: null,
      semanticCompleteness: 'unqualified', originalReceiptRef: null });
  }
  cases.sort((a, b) => compare(a.caseId, b.caseId));
  witnesses.sort((a, b) => compare(JSON.stringify([a.contractId, a.consumerId, a.caseId]), JSON.stringify([b.contractId, b.consumerId, b.caseId])));
  const consolidations = ownership.payload.suites.map(suite => ({
    suiteId: suite.id, coverageOwner: suite.coverageOwner, processIsolationRequired: suite.processIsolationRequired,
    ownerCaseIds: bySuite.get(suite.id) || (byCase.has(suite.id) ? [suite.id] : []),
    replacementIds: suite.replacementIds, overlapPolicy: suite.overlapPolicy,
    equivalenceStatus: 'declared-not-qualified'
  })).sort((a, b) => compare(a.suiteId, b.suiteId));
  const sources = [...files.values()].map(({ text: _text, ...source }) => source).sort((a, b) => compare(a.path, b.path));
  const manifestDigest = hash(JSON.stringify([projectionIdentity.digest, sources.map(source => [source.path, source.hash])]));
  return { schemaVersion: 1, kind: 'consumer-proof-index', mode: 'observe-only',
    projectionIdentity,
    sourceManifestDigest: manifestDigest, sourceScope: 'observed-registry-and-case-inputs',
    registries: [SHIPPED_SURFACES_REGISTRY_PATH, relative(ownership.path), 'tests/run.rules.jsonc', 'tests/runner/lane-manifests.jsonc'],
    surfaces: shipped.surfaces.map(surface => ({ id: surface.id, owner: surface.owner,
      runtimeTargets: surface.runtimeTargets, buildSourcePaths: surface.build.sourcePaths,
      releaseCheckIds: surface.releaseCheck.steps.map(step => step.id) })),
    cases, witnesses, consolidations, sources,
    summary: { cases: cases.length, declaredWitnesses: witnesses.length, qualifiedWitnesses: 0,
      sourceFiles: sources.length, readBytes },
    unavailable: ['execution-receipts', 'semantic-completeness', 'scanner-entry-graph', 'cross-partition-clones',
      'unread-source-files', 'external-platform-qualification'],
    releaseQualificationOwner: 'tools/release/report-contract.js' };
};

/** Candidate diagnostic only. Changed code requires review even if a case ID
 * survives. A declarative replacement never proves a removed assertion safe.
 */
export const compareConsumerProofIndexes = (before, after) => {
  if ([before, after].some(index => index?.schemaVersion !== 1 || index?.kind !== 'consumer-proof-index'
    || index?.mode !== 'observe-only' || !Array.isArray(index.cases) || !Array.isArray(index.witnesses))) {
    throw invalid('Expected current observe-only proof indexes.');
  }
  const currentCases = new Map(after.cases.map(row => [row.caseId, row]));
  const currentWitnesses = new Map(after.witnesses.map(row => [JSON.stringify([row.contractId, row.consumerId, row.caseId]), row]));
  const findings = [];
  if (before.projectionIdentity?.digest !== after.projectionIdentity?.digest) findings.push({ kind: 'changed-projector', reviewRequired: true });
  for (const row of before.cases) {
    const current = currentCases.get(row.caseId);
    if (!current) findings.push({ kind: 'removed-case', caseId: row.caseId, reviewRequired: true });
    else if (row.sourceHash !== current.sourceHash) findings.push({ kind: 'changed-case-source', caseId: row.caseId, reviewRequired: true });
  }
  for (const row of before.witnesses) {
    const key = JSON.stringify([row.contractId, row.consumerId, row.caseId]), current = currentWitnesses.get(key);
    const fields = value => JSON.stringify([value.requiredScope, value.expectedOracleKind, value.negativeCaseIds, value.sourcePaths]);
    if (!current || fields(row) !== fields(current)) findings.push({ kind: 'changed-consumer-witness',
      contractId: row.contractId, consumerId: row.consumerId, caseId: row.caseId, reviewRequired: true });
    else if (JSON.stringify(row.sources.map(source => [source.path, source.hash]))
      !== JSON.stringify(current.sources.map(source => [source.path, source.hash]))) findings.push({ kind: 'changed-consumer-source',
      contractId: row.contractId, consumerId: row.consumerId, caseId: row.caseId, reviewRequired: true });
  }
  return { mode: 'observe-only', beforeSourceManifestDigest: before.sourceManifestDigest,
    afterSourceManifestDigest: after.sourceManifestDigest, findings, destructiveConsolidationQualified: false };
};

if (isDirectExecution(import.meta.url)) {
  buildConsumerProofIndex().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
