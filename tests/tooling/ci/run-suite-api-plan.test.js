#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd(), env = applyTestEnv({ syncProcess: false });
for (const mode of ['ci', 'nightly']) {
  const plan = runNode(['tools/ci/run-suite.js', '--mode', mode, '--dry-run', '--skip-prechecks'],
    `${mode} API and serial qualification plan`, root, env, { stdio: 'pipe' });
  const lines = String(plan.stderr).split(/\r?\n/);
  const api = lines.find(line => line.startsWith('[dry-run] API contract cohort:'));
  assert.ok(api, `${mode}: portable API authorization and search require a scheduled owner`);
  const serial = lines.find(line => line.startsWith('[dry-run] Serial runtime budgets:'));
  assert.ok(serial);
  for (const line of [api, serial]) {
    for (const option of ['--lane all', '--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000',
      '--retries 0', '--native-status-redo=false']) assert.ok(line.includes(option), `${option}: ${line}`);
    const selectors = [...line.matchAll(/--match (\/\S+\/)/g)].map(match => match[1]);
    assert.ok(selectors.length > 0);
    const selected = runNode(['tests/run.js', '--lane', 'all', ...selectors.flatMap(value => ['--match', value]), '--list'],
      'list exact scheduled cohort', root, env, { stdio: 'pipe' }).stdout.trim().split(/\r?\n/);
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
    } else assert.deepEqual(selected.sort(), ['perf/parsers/jinja-cold-budget', 'perf/parsers/toml-cold-budget', 'tooling/reports/summary/report']);
  }
}
console.log('CI/nightly API cohorts resolve authorization, search and federation; strict runtime budgets execute serially');
