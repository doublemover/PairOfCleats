#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getTriageContext, run, runJson } from '../../helpers/triage.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { TRIAGE_EVIDENCE_VERSION } from '../../../src/contracts/triage-evidence.js';
import { TRIAGE_HISTORY_SELECTION_VERSION } from '../../../src/contracts/triage-history.js';
import { assertTriageHistorySelection } from '../../../src/contracts/validators/triage-history.js';

const buildTriageEvidenceRepo = async (repoRoot) => {
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'comments.js'),
    '/** CVE-2024-0001 extracted evidence sentinel */\nexport const unrelated = 1;\n'
  );
  await fsPromises.writeFile(path.join(repoRoot, 'README.md'), '# Guide\n\nUse add-helper for adding values.\n');
  await fsPromises.writeFile(
    path.join(repoRoot, '.pairofcleats.json'),
    `${JSON.stringify({
      indexing: {
        embeddings: {
          enabled: false
        }
      }
    }, null, 2)}\n`,
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'util.js'),
    [
      "import addHelper from 'add-helper';",
      '',
      'export function handlePublicApiInput(left, right) {',
      '  return addHelper(left, right);',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
};

const { root, repoRoot, triageFixtureRoot, env, cacheRoot, writeTestLog } = await getTriageContext({
  name: 'triage-context-pack',
  fixtureBuilder: buildTriageEvidenceRepo,
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: {
        enabled: false
      }
    }
  }
});

const ingestGeneric = runJson('ingest-generic', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', path.join(triageFixtureRoot, 'generic.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

if (!Array.isArray(ingestGeneric.recordIds) || ingestGeneric.recordIds.length === 0) {
  console.error('No records written for generic ingest.');
  process.exit(1);
}
const findingId = ingestGeneric.recordIds[0];

runJson('decision', [
  path.join(root, 'tools', 'triage', 'decision.js'),
  '--finding', findingId,
  '--status', 'accept',
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

run('build-index', [
  path.join(root, 'build_index.js'),
  '--stage', 'stage2',
  '--mode', 'all',
  '--stub-embeddings',
  '--repo', repoRoot
], { cwd: repoRoot, env });

const contextOut = path.join(cacheRoot, 'context-pack.json');
const artifact = runJson('context-pack', [
  path.join(root, 'tools', 'triage', 'context-pack.js'),
  '--record', findingId,
  '--repo', repoRoot,
  '--out', contextOut,
  '--stub-embeddings',
  '--no-ann'
], { cwd: repoRoot, env });

if (!fs.existsSync(contextOut)) {
  console.error('Context pack output was not written.');
  process.exit(1);
}

const pack = JSON.parse(await fsPromises.readFile(contextOut, 'utf8'));
assertTriageHistorySelection(pack.historySelection);
assert.equal(pack.historySelection.schemaVersion, TRIAGE_HISTORY_SELECTION_VERSION);
assert.equal(pack.historySelection.items.length, pack.history.length);
assert.equal(pack.historySelection.items.some(item => item.relation === 'exactFinding' && item.findingRecordId === findingId), true,
  'actual ingest/decision/context CLI retains the original finding link');
for (const item of pack.historySelection.items) assert.equal(pack.history.some(record => record.recordId === item.sourceDecisionId), true);
await writeTestLog('triage-context-pack.json', pack);
await writeTestLog('triage-context-pack-evidence.json', pack.repoEvidence || {});
await writeTestLog('triage-context-pack-history.json', { history: pack.history || [] });

if (!pack.recordId || !pack.finding || !pack.repoEvidence) {
  console.error('Context pack missing required fields.');
  process.exit(1);
}
if (!pack.finding.exposure || pack.finding.exposure.internetExposed !== true) {
  console.error('Context pack did not include exposure metadata.');
  process.exit(1);
}
if (!Array.isArray(pack.history) || pack.history.length === 0) {
  console.error('Context pack missing history records.');
  process.exit(1);
}
if (!Array.isArray(pack.repoEvidence.queries) || pack.repoEvidence.queries.length === 0) {
  console.error('Context pack missing evidence queries.');
  process.exit(1);
}
const importQuery = pack.repoEvidence.queries.some((entry) => entry.query === 'add-helper');
if (!importQuery) {
  console.error('Context pack evidence queries did not include import name.');
  process.exit(1);
}
const totalEvidenceHits = pack.repoEvidence.queries.reduce((sum, entry) => sum + (entry.hits?.length || 0), 0);
if (totalEvidenceHits === 0) {
  console.error('Context pack contains no evidence hits.');
  process.exit(1);
}

assert.equal(pack.evidenceVersion, TRIAGE_EVIDENCE_VERSION);
assert.equal(artifact.evidenceVersion, TRIAGE_EVIDENCE_VERSION);
assert.equal(path.relative(artifact.searchedRepository.root, repoRoot), '');
assert.equal(artifact.outPath, contextOut);
for (const [mode, query, file] of [
  ['code', 'add-helper', 'src/util.js'],
  ['prose', 'add-helper', 'README.md'],
  ['extracted-prose', 'CVE-2024-0001', 'comments.js']
]) {
  const direct = runJson(`direct-${mode}`, [path.join(root, 'search.js'), '--repo', repoRoot,
    '--mode', mode, '--json', '--no-ann', '-n', '5', query], { cwd: repoRoot, env });
  const key = mode === 'extracted-prose' ? 'extractedProse' : mode;
  const expected = direct[key].find(hit => hit.file === file);
  assert.ok(expected, `${mode} independently expected ${file}`);
  const evidence = pack.repoEvidence.queries.find(row => row.mode === mode && row.query === query);
  assert.equal(evidence?.status, 'success');
  assert.equal(path.relative(evidence.repository.root, repoRoot), '');
  const hit = evidence.hits.find(row => row.file === file);
  assert.ok(hit, `actual persisted ${mode} evidence must retain ${file}`);
  assert.equal(hit.source.chunkUid, expected.chunkUid || expected.metaV2?.chunkUid || null);
  assert.ok(hit.source.chunkUid, 'built evidence must have stable chunk identity');
  assert.equal(hit.source.offsets.start, expected.start ?? null);
  assert.equal(hit.source.offsets.end, expected.end ?? null);
  assert.equal(hit.source.lines.start, expected.startLine ?? null);
  assert.equal(hit.source.lines.end, expected.endLine ?? null);
  assert.equal(hit.source.navigation.status, 'unavailable');
  assert.equal(hit.preview.exactSourceSupport, false);
  assert.equal(evidence.retrieval.backend.selected, direct.retrieval.backend.selected);
  assert.equal(evidence.retrieval.fidelity.status, direct.retrieval.fidelity.status);
  assert.deepEqual(evidence.retrieval.freshness.mode, direct.retrieval.freshness.byMode[key]);
  assert.equal(evidence.retrieval.freshness.mode.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
}
assert.ok(pack.repoEvidence.queries.some(row => row.status === 'empty' && row.hits.length === 0),
  'the absent endpoint query must remain an explicit successful zero');

console.log('Triage context pack ok.');
