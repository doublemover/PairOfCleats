#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildBenchEnvironmentMetadata } from '../../../tools/bench/language/logging.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-report-environment');
const resultsRoot = path.join(tempRoot, 'results');
const environmentMetadata = buildBenchEnvironmentMetadata({
  PAIROFCLEATS_TESTING: '1',
  ORG_GRADLE_DAEMON: 'false',
  GRADLE_OPTS: '-Dorg.gradle.daemon=false'
});

assert.ok(environmentMetadata.fingerprint, 'expected environment metadata fingerprint');
assert.equal(environmentMetadata.selected.PAIROFCLEATS_TESTING, '1');
assert.equal(environmentMetadata.selected.ORG_GRADLE_DAEMON, 'false');

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot,
  results: [],
  config: {},
  environmentMetadata
});

assert.equal(output.environment?.fingerprint, environmentMetadata.fingerprint, 'expected report output to carry environment fingerprint');
assert.equal(output.environment?.selected?.PAIROFCLEATS_TESTING, '1', 'expected report output to carry selected environment metadata');

console.log('bench language report environment metadata test passed');
