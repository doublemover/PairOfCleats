#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { parse } from 'yaml';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd(), env = applyTestEnv({ syncProcess: false });
const providerAndParityIds = ['tooling/install/application-owned-node-detect', 'retrieval/parity/partial-ranks-report'];
const publicationIds = JSON.parse(fs.readFileSync(path.join(root, 'tests/storage/native-publication-cleanup.test.js.cases.json'), 'utf8')).cases
  .map(id => `storage/native-publication-cleanup/${id}`);
const reuseIds = ['runtime-import-reuse', 'runtime-claims-reuse', 'runtime-control-replacement-accounting'].flatMap(family =>
  JSON.parse(fs.readFileSync(path.join(root, `tests/storage/semantic/${family}.test.js.cases.json`), 'utf8')).cases
    .map(id => `storage/semantic/${family}/${id}`));
const riskWitnessWorkIds = JSON.parse(fs.readFileSync(path.join(root,
  'tests/perf/risk/witness-retention-work.test.js.cases.json'), 'utf8')).cases
  .map(id => `perf/risk/witness-retention-work/${id}`);
const artifactLeaseWorkIds = JSON.parse(fs.readFileSync(path.join(root,
  'tests/perf/embeddings/artifact-lease-work.test.js.cases.json'), 'utf8')).cases
  .map(id => `perf/embeddings/artifact-lease-work/${id}`);
const validationWorkIds = JSON.parse(fs.readFileSync(path.join(root,
  'tests/perf/indexing/validate/manifest-fusion-work.test.js.cases.json'), 'utf8')).cases
  .map(id => `perf/indexing/validate/manifest-fusion-work/${id}`);
const sourceAuthorityIds = JSON.parse(fs.readFileSync(path.join(root,
  'tests/storage/semantic/runtime-source-reference-authority.test.js.cases.json'), 'utf8')).cases
  .map(id => `storage/semantic/runtime-source-reference-authority/${id}`);
sourceAuthorityIds.push('storage/semantic/runtime-source-reference-foreign-generation');
const workflow = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
for (const platform of ['ubuntu', 'windows', 'macos']) {
  const upload = workflow.jobs[platform].steps.find(step => step.uses?.startsWith('actions/upload-artifact@')
    && step.with.path?.includes('.diagnostics/serial-runtime-budgets.json'));
  assert.ok(upload?.with.path.includes('.diagnostics/serial-compiler-api-contracts.json'),
    `${platform}: retain the independently scheduled compiler report`);
  assert.ok(upload.with.path.split(/\r?\n/).includes('.testLogs/bench35-*.json'),
    `${platform}: successful runs must retain raw benchmark receipts, not only log pointers`);
  assert.ok(upload.with.path.split(/\r?\n/).includes('.testLogs/build-cli-selected-outcome-*.json'),
    `${platform}: retain complete selected-outcome child status, error and output on successful and failed runs`);
}
// These list commands are read-only and share one root/environment/source
// snapshot. Reuse identical CI/nightly cohort recipes; execute each exact argv
// once, retaining every per-mode assertion and returning a fresh sortable copy.
const cohortSelections = new Map();
let cohortChecks = 0;
const listScheduledCohort = selectors => {
  cohortChecks++;
  const args = ['tests/run.js', '--lane', 'all', ...selectors.flatMap(value => ['--match', value]), '--list'];
  const key = JSON.stringify(args);
  if (!cohortSelections.has(key)) {
    const selected = runNode(args, 'list exact scheduled cohort', root, env, { stdio: 'pipe' })
      .stdout.trim().split(/\r?\n/);
    cohortSelections.set(key, Object.freeze(selected));
  }
  return [...cohortSelections.get(key)];
};
for (const mode of ['ci', 'nightly']) {
  const plan = runNode(['tools/ci/run-suite.js', '--mode', mode, '--dry-run', '--skip-prechecks'],
    `${mode} API and serial qualification plan`, root, env, { stdio: 'pipe' });
  const lines = String(plan.stderr).split(/\r?\n/);
  const api = lines.find(line => line.startsWith('[dry-run] API contract cohort:'));
  assert.ok(api, `${mode}: portable API authorization and search require a scheduled owner`);
  const serial = lines.find(line => line.startsWith('[dry-run] Serial runtime budgets:'));
  assert.ok(serial);
  assert.ok(lines.indexOf(serial) < lines.findIndex(line => line.startsWith('[dry-run] CI test lane:')),
    'bounded serial qualification must report failures before the large parallel lane');
  const ann = lines.find(line => line.startsWith('[dry-run] Serial ANN generation:'));
  assert.ok(ann);
  const native = lines.find(line => line.startsWith('[dry-run] Serial native lifecycle:'));
  assert.ok(native);
  const compiler = lines.find(line => line.startsWith('[dry-run] ') && line.includes('serial-compiler-api-contracts.json'));
  assert.ok(compiler, `${mode}: bounded compiler/API cases need an independent serial owner`);
  assert.ok(lines.indexOf(compiler) < lines.findIndex(line => line.startsWith('[dry-run] CI test lane:')));
  assert.ok(compiler.includes('serial-compiler-api-contracts.json'));
  for (const line of [api, serial, ann, native, compiler]) {
    for (const option of ['--lane all', '--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000',
      '--retries 0', '--native-status-redo=false']) assert.ok(line.includes(option), `${option}: ${line}`);
    const selectors = [...line.matchAll(/--match (\/\S+\/)/g)].map(match => match[1]);
    assert.ok(selectors.length > 0);
    const selected = listScheduledCohort(selectors);
    assert.ok(selected.length > 0);
    assert.equal(new Set(selected).size, selected.length);
    if (line === api) {
      const orderedApiIds = ['ci-lite', 'ci', 'ci-long'].flatMap(lane =>
        JSON.parse(fs.readFileSync(path.join(root, `tests/${lane}/${lane}.manifest.json`), 'utf8')).tests
          .map(test => test.id).filter(id => id.startsWith('services/api/')));
      for (const id of orderedApiIds) assert.ok(selected.includes(id), `${mode}: ordered API case ${id} cannot disappear behind a family exclusion`);
      for (const id of ['services/api/repo-authorization', 'services/api/search-contract-matrix',
        'services/api/federated-search-validation-matrix', 'services/api/search-stream-outcomes']) {
        assert.ok(selected.includes(id), `${mode}: ${id} must actually resolve`);
      }
    } else {
      const compilerFamilies = ['export-identity-cli', 'zero-warning-cap-cli',
        'typescript-parameter-cli', 'qualified-target-joins-cli'];
      const compilerIds = compilerFamilies.flatMap(family =>
        JSON.parse(fs.readFileSync(path.join(root, `tests/tooling/api-contracts/${family}.test.js.cases.json`), 'utf8')).cases
          .map(id => `tooling/api-contracts/${family}/${id}`)).sort();
      const outcomeIds = JSON.parse(fs.readFileSync(path.join(root, 'tests/indexing/runtime/build-cli-selected-outcome.test.js.cases.json'), 'utf8')).cases
        .map(id => `indexing/runtime/build-cli-selected-outcome/${id}`);
      assert.deepEqual(selected.sort(), line === compiler ? [...compilerIds, ...outcomeIds, ...providerAndParityIds, ...sourceAuthorityIds].sort()
        : line === native ? ['storage/sqlite/build/cancellation', ...publicationIds].sort()
          : line === ann ? ['retrieval/ann/generation-lmdb',
            'retrieval/ann/generation-publication', 'retrieval/ann/generation-rebuild-failure']
            : ['indexing/semantic/compiler-single-cpu-lifecycle',
              ...reuseIds,
              ...riskWitnessWorkIds,
              ...artifactLeaseWorkIds,
              ...validationWorkIds,
              'indexing/embeddings/artifact-installed-closure', 'embeddings/onnx/installation-closure',
              'embeddings/onnx/downloader-installation-consumer',
              'indexing/artifacts/binary-frame-manifest-integrity', 'indexing/semantic/sealed-piece-manifest-work',
              'indexing/artifacts/field-postings-adaptive-shards-and-binary',
              'shared/artifact-io/binary-frame-checksum-receipts/oversized',
              ...['shared-1', 'shared-4', 'shared-16', 'distinct-1', 'distinct-4', 'distinct-16']
                .map(id => `storage/semantic/source-retention-partition-work/${id}`),
              'map/member-join-work-consumer/measure',
              ...['render', 'graph-skewed', 'graph-skewed-independent', 'map-large', 'memory-transient', 'vfs-ascii',
                'vfs-many-persisted-1', 'vfs-many-persisted-2', 'vfs-many-persisted-3',
                'vfs-many-hot-1', 'vfs-many-hot-2', 'vfs-many-hot-3', 'vfs-budget',
                'sqlite-wide-a1', 'sqlite-wide-a2', 'sqlite-wide-b1', 'sqlite-wide-b2', 'sqlite-wide-c1', 'sqlite-wide-c2']
                .map(id => `perf/bench/representative-workload-consumers/${id}`),
              ...['results', 'publication'].map(id => `perf/bench/selected-cohort-generation-consumer/${id}`),
              'perf/parsers/jinja-cold-budget', 'perf/parsers/toml-cold-budget', 'perf/parsers/xml-cold-budget',
              'retrieval/backend/fts-cooperative-timing-consumer',
              'smoke/baseline-negative/corrupt', 'smoke/baseline-negative/incomplete',
              'smoke/baseline-negative/legacy', 'smoke/baseline-negative/missing',
              'tooling/reports/summary/report'].sort());
      const broad = lines.find(value => value.startsWith('[dry-run] CI test lane:'));
      for (const id of selected) {
        const exclusion = `--exclude /^${id.replaceAll('/', '\\/')}$/`;
        assert.equal(broad.split(exclusion).length - 1, 1, `${mode}: ${id} has exactly one serial replacement owner`);
      }
      if (line === compiler) {
        const orderedCompiler = JSON.parse(fs.readFileSync(path.join(root, 'tests/ci-lite/ci-lite.manifest.json'), 'utf8')).tests
          .map(test => test.id).filter(id => compilerFamilies.some(family =>
            id.startsWith(`tooling/api-contracts/${family}/`)) || outcomeIds.includes(id) || providerAndParityIds.includes(id)
            || sourceAuthorityIds.includes(id)).sort();
        assert.deepEqual(selected, orderedCompiler, 'every original ordered case retains its serial execution owner');
      }
    }
  }
}
console.log(JSON.stringify({ measurement: 'ci-plan-discovery-work', cohortChecks, uniqueCliLists: cohortSelections.size,
  scope: 'one read-only root/environment/source snapshot; every distinct original CLI argv executes' }));
console.log('CI/nightly API cohorts resolve authorization, search and federation; strict runtime budgets execute serially');
