#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyBenchTierBySize, validateBenchSizeObservations, validateBenchTierConfig } from '../../../tools/bench/language/tier-policy.js';
import { buildTaskCatalog } from '../../../tools/bench/language-repos/planning.js';

const config = JSON.parse(fs.readFileSync('benchmarks/repos.json', 'utf8'));
const observations = JSON.parse(fs.readFileSync('benchmarks/repo-size-observations.json', 'utf8'));
assert.equal(validateBenchTierConfig(config).ok, true);
for (const loc of [null, undefined, '', '  ', false, true, [], {}, NaN, Infinity, -1]) {
  assert.equal(classifyBenchTierBySize({ loc, files: 400 }), 'medium', `unknown LOC uses file count: ${String(loc)}`);
}
assert.equal(classifyBenchTierBySize({ loc: 0, files: 30000 }), 'small', 'explicit zero LOC is a measurement');
assert.equal(classifyBenchTierBySize({ loc: '25000', files: 1 }), 'medium', 'numeric text remains compatible');
assert.equal(classifyBenchTierBySize({ loc: null, files: null }), null);
for (const [loc, expected] of [[24999, 'small'], [25000, 'medium'], [299999, 'medium'],
  [300000, 'large'], [2999999, 'large'], [3000000, 'huge']]) {
  assert.equal(classifyBenchTierBySize({ loc }), expected);
}
assert.equal(observations.records.length, 120);
assert.equal(observations.unknown.length, 1);
const now = Date.parse('2026-10-04T10:00:00Z');
const validation = validateBenchSizeObservations({ config, observations, now });
assert.equal(validation.ok, true);
assert.equal(validation.liveRevisionsVerified, false, 'a recent archive is not a live remote-head verification');
assert.ok(validation.records.every((row) => row.revisionStatus === 'unverified'));
const moved = observations.records.filter((row) => classifyBenchTierBySize({ loc: row.codeModeLoc, files: row.codeModeFiles }) === 'medium');
assert.equal(moved.length, 29);
assert.equal(new Set(moved.map((row) => row.repo)).size, 28);
for (const row of moved) {
  assert.ok(config[row.language].repos.medium.includes(row.repo));
  assert.ok(!config[row.language].repos.small.includes(row.repo));
}
const tasks = buildTaskCatalog({ benchConfig: config, argv: { tier: 'small' }, scriptRoot: process.cwd() });
assert.equal(tasks.length, 92);
assert.ok(tasks.some((row) => row.repo.includes('openmoonray')), 'unmeasured repositories retain their assignment');
const sample = observations.records[0];
const key = `${sample.language}:${sample.repo}`;
const changed = validateBenchSizeObservations({ config, observations, now, revisions: { [key]: '0'.repeat(40) } });
assert.ok(changed.records[0].issues.includes('revision-changed'));
assert.equal(changed.ok, false);
const stale = validateBenchSizeObservations({ config, observations, now: now + 91 * 86400000 });
assert.ok(stale.records.every((row) => row.issues.includes('measurement-stale')));
const current = validateBenchSizeObservations({ config, observations, now,
  revisions: Object.fromEntries(observations.records.map((row) => [`${row.language}:${row.repo}`, row.revision])) });
assert.equal(current.liveRevisionsVerified, true, 'caller-provided matched revisions establish only the declared comparison');
const blazor = moved.find((row) => /blazor[-_]?samples/iu.test(row.repo));
assert.equal(blazor.codeModeFiles, 4978);
assert.equal(classifyBenchTierBySize({ loc: blazor.codeModeLoc, files: blazor.codeModeFiles }), 'medium', 'LOC-first policy does not confuse files with LOC');
console.log('Measured tier moves, unknown LOC fallback, provenance age/revision controls, and small selection are consistent.');
