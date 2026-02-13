#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';

const workspacePath = 'C:\\workspace\\.pairofcleats-workspace.jsonc';
const request = parseFederatedCliRequest([
  '--workspace',
  workspacePath,
  '--mode',
  'records',
  'find-me'
]);

assert.equal(request.workspacePath, workspacePath);
assert.equal(request.query, 'find-me');
assert.equal(request.mode, 'records', 'CLI --mode should be propagated to federated request payload');

console.log('federated cli mode forwarding test passed');
