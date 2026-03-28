#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildSearchShowcaseReviewReport,
  loadSearchShowcaseDataset,
  selectSearchShowcaseCases,
  resolveTerminalSizeMatrix
} from '../../../tools/testing/run-search-showcase.js';

const root = process.cwd();
const fixtureDir = path.join(root, 'tests', 'fixtures', 'pairofcleats-search-showcase');
const showcasePath = path.join(fixtureDir, 'showcase.json');
const displayReviewPath = path.join(fixtureDir, 'display-review.json');
const evalPath = path.join(fixtureDir, 'eval.json');

assert.equal(fs.existsSync(showcasePath), true, 'expected showcase dataset to exist');
assert.equal(fs.existsSync(displayReviewPath), true, 'expected display review dataset to exist');
assert.equal(fs.existsSync(evalPath), true, 'expected eval dataset to exist');

const { dataset } = loadSearchShowcaseDataset(showcasePath);
assert.equal(dataset.tool, 'pairofcleats');
assert.equal(dataset.schemaVersion, 1);
assert.ok(Array.isArray(dataset.featureSets) && dataset.featureSets.length >= 4, 'expected feature sets');
assert.ok(Array.isArray(dataset.cases) && dataset.cases.length >= 20, 'expected a broad case catalog');

const ids = new Set();
for (const entry of dataset.cases) {
  assert.equal(typeof entry.id, 'string', 'expected case id');
  assert.ok(
    typeof entry.query === 'string' || (Array.isArray(entry.commandArgs) && entry.commandArgs.length > 0),
    `expected query or commandArgs for ${entry.id}`
  );
  if (typeof entry.query === 'string') {
    assert.equal(typeof entry.mode, 'string', `expected mode for ${entry.id}`);
  }
  assert.equal(typeof entry.category, 'string', `expected category for ${entry.id}`);
  assert.equal(typeof entry.stability, 'string', `expected stability for ${entry.id}`);
  assert.equal(ids.has(entry.id), false, `duplicate showcase case id: ${entry.id}`);
  ids.add(entry.id);
}

const stableCases = selectSearchShowcaseCases(dataset, {});
assert.ok(stableCases.length >= 10, 'expected stable default cases');

const allCases = selectSearchShowcaseCases(dataset, {
  includeOptional: true,
  includeExploratory: true
});
assert.equal(allCases.length, dataset.cases.length, 'expected full selection to include every case');

const defaultSizes = resolveTerminalSizeMatrix();
assert.ok(defaultSizes.length >= 6, 'expected a useful default terminal matrix');
assert.equal(defaultSizes[0].id, 'default', 'expected matrix to start with default terminal size');
assert.ok(defaultSizes.some((entry) => entry.id === '188x30'), 'expected large showcase terminal size 188x30');

const overriddenSizes = resolveTerminalSizeMatrix(['default', '80x24', '188x30']);
assert.deepEqual(
  overriddenSizes.map((entry) => entry.id),
  ['default', '80x24', '188x30'],
  'expected explicit terminal sizes to preserve order'
);

const evalCases = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
assert.ok(Array.isArray(evalCases) && evalCases.length >= 8, 'expected stable eval subset');

const listRun = spawnSync(process.execPath, [
  path.join(root, 'tools', 'testing', 'run-search-showcase.js'),
  '--dataset',
  showcasePath,
  '--list'
], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(listRun.status, 0, `expected --list to succeed: ${listRun.stderr}`);
assert.match(listRun.stdout, /code-parse-search-args/, 'expected list output to include a stable case');
assert.match(listRun.stdout, /output-json-compact-score-breakdown/, 'expected list output to include an output case');

const ptyListRun = spawnSync(process.execPath, [
  path.join(root, 'tools', 'testing', 'run-search-showcase.js'),
  '--dataset',
  showcasePath,
  '--pty',
  '--list'
], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(ptyListRun.status, 0, `expected --pty --list to succeed: ${ptyListRun.stderr}`);
assert.match(ptyListRun.stdout, /prose-search-pipeline/, 'expected PTY list output to include a stable prose case');

const { dataset: displayReview } = loadSearchShowcaseDataset(displayReviewPath);
assert.ok(Array.isArray(displayReview.cases) && displayReview.cases.length >= 12, 'expected broad display review catalog');
assert.ok(displayReview.cases.some((entry) => entry.id === 'cli-help'), 'expected help case in display review dataset');
assert.ok(displayReview.cases.some((entry) => entry.id === 'human-no-results'), 'expected empty-state case in display review dataset');
assert.ok(displayReview.cases.some((entry) => entry.id === 'human-records-hit'), 'expected positive records case in display review dataset');
assert.ok(
  displayReview.cases.some((entry) => entry.id === 'human-default-mixed' && Array.isArray(entry.reviewExpect?.contains)),
  'expected review expectations on mixed human output case'
);

const reviewReport = buildSearchShowcaseReviewReport({
  suiteDir: path.join(root, '.testLogs', 'fake-search-review'),
  runs: [
    {
      id: 'demo',
      status: 'ok',
      captureMode: 'pty',
      outputDir: path.join(root, '.testLogs', 'fake-search-review', 'demo'),
      terminalSize: { id: '72x20', columns: 72, lines: 20 },
      review: {
        overflowCount: 2,
        blankPairCount: 1,
        missingExpectedCount: 1,
        emptySectionCount: 0,
        sectionCount: 3,
        usedWidth: 72
      }
    }
  ]
});
assert.equal(reviewReport.overflowCount, 2, 'expected review report to aggregate overflow counts');
assert.equal(reviewReport.blankPairCount, 1, 'expected review report to aggregate blank pairs');
assert.equal(reviewReport.missingExpectedCount, 1, 'expected review report to aggregate missing expected content');
assert.equal(reviewReport.worstRuns[0].id, 'demo', 'expected review report to rank captured runs');

console.log('search showcase fixture test passed');
