#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

applyTestEnv();

const CASES = [
  {
    id: 'graphql',
    source: [
      '#import "shared.graphql"',
      'type Query {',
      '  user: User',
      '}',
      'type User {',
      '  id: ID',
      '}',
      'fragment UserFields on User {',
      '  id',
      '}'
    ].join('\n'),
    expectedImport: 'shared.graphql',
    expectedExport: 'Query',
    expectedUsage: 'User'
  },
  {
    id: 'proto',
    source: [
      'syntax = "proto3";',
      'import "shared.proto";',
      'message Address {',
      '  string city = 1;',
      '}',
      'message User {',
      '  Address address = 1;',
      '}',
      'message GetUserReq {',
      '  string id = 1;',
      '}',
      'service UserService {',
      '  rpc GetUser (GetUserReq) returns (User);',
      '}'
    ].join('\n'),
    expectedImport: 'shared.proto',
    expectedExport: 'User',
    expectedUsage: 'Address'
  }
];

for (const testCase of CASES) {
  const entry = LANGUAGE_REGISTRY.find((row) => row.id === testCase.id);
  assert.ok(entry, `missing registry entry for ${testCase.id}`);
  assert.equal(entry.capabilityProfile, undefined, `${testCase.id} should not be marked as import-collector downgrade`);

  const relations = entry.buildRelations({ text: testCase.source, options: {} }) || {};
  assert.ok(Array.isArray(relations.imports), `${testCase.id} should emit imports array`);
  assert.ok(relations.imports.includes(testCase.expectedImport), `${testCase.id} should keep expected import`);
  assert.ok(Array.isArray(relations.exports), `${testCase.id} should emit exports array`);
  assert.ok(relations.exports.includes(testCase.expectedExport), `${testCase.id} should emit heuristic export symbol`);
  assert.ok(Array.isArray(relations.usages), `${testCase.id} should emit usages array`);
  assert.ok(relations.usages.includes(testCase.expectedUsage), `${testCase.id} should emit schema usage`);
  assert.ok(Array.isArray(relations.calls), `${testCase.id} should emit calls array`);
  assert.ok(relations.calls.some((entryCall) => Array.isArray(entryCall) && entryCall[1] === testCase.expectedUsage), `${testCase.id} should emit call edges`);

  const chunk = {
    name: testCase.expectedExport,
    start: 0,
    end: testCase.source.length
  };
  const docmeta = entry.extractDocMeta({ chunk });
  assert.equal(docmeta?.symbol, testCase.expectedExport, `${testCase.id} should emit heuristic docmeta symbol`);

  const flow = entry.flow({
    text: testCase.source,
    chunk,
    options: { astDataflowEnabled: true, controlFlowEnabled: true }
  });
  assert.ok(flow && flow.controlFlow, `${testCase.id} should emit control flow summary`);
  assert.equal(typeof flow.controlFlow.branches, 'number', `${testCase.id} controlFlow.branches must be numeric`);
}

console.log('data-interface heuristic adapters contract test passed');
