#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const runSearchModule = await import('../../../src/retrieval/cli/run-search.js');
assert.equal(typeof runSearchModule.runSearchCli, 'function', 'expected run-search module to export runSearchCli');

const retrievalCliModule = await import('../../../src/retrieval/cli.js');
assert.equal(typeof retrievalCliModule.runSearchCli, 'function', 'expected retrieval cli module to export runSearchCli');

console.log('retrieval run-search module load test passed');
