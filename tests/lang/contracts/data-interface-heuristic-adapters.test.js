#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { assertHeuristicAdapterCases } from '../helpers/heuristic-adapter-contracts.js';

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

assertHeuristicAdapterCases(CASES, { usageLabel: 'schema usage' });

console.log('data-interface heuristic adapters contract test passed');
