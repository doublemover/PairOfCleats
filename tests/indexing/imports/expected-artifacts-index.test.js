#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createExpectedArtifactsIndex,
  matchGeneratedExpectationSpecifier
} from '../../../src/index/build/import-resolution.js';

const entries = [
  'python/service/main.py',
  'python/service/proto/client.proto',
  'graphql/schema.graphql',
  'api/openapi.yaml',
  'lib/src/model.dart',
  'src/main.js'
];

const index = createExpectedArtifactsIndex({ entries });
assert.equal(index.version, 'expected-artifacts-index-v2');
assert.equal(typeof index.fingerprint, 'string');
assert.equal(index.indexedFileCount, entries.length);
assert.equal(index.expectedPathCount > 0, true, 'expected generated path predictions');

const protoMatch = index.match({
  importer: 'python/service/main.py',
  specifier: './proto/client_pb2.py'
});
assert.equal(protoMatch.matched, true);
assert.equal(protoMatch.source, 'index');
assert.equal(protoMatch.matchType, 'expected_output_path');
assert.equal(protoMatch.candidate, 'python/service/proto/client_pb2.py');

const protoTsMatch = index.match({
  importer: 'python/service/main.py',
  specifier: './proto/client.pb.ts'
});
assert.equal(protoTsMatch.matched, true);
assert.equal(protoTsMatch.source, 'index');

const graphqlMatch = index.match({
  importer: 'src/main.js',
  specifier: '../graphql/schema.generated.ts'
});
assert.equal(graphqlMatch.matched, true);
assert.equal(graphqlMatch.source, 'index');

const dartMatch = index.match({
  importer: 'lib/main.dart',
  specifier: './src/model.g.dart'
});
assert.equal(dartMatch.matched, true);
assert.equal(dartMatch.source, 'index');

const openApiGeneratedMatch = index.match({
  importer: 'api/main.ts',
  specifier: './openapi.client.ts'
});
assert.equal(openApiGeneratedMatch.matched, true);
assert.equal(openApiGeneratedMatch.source, 'index');
assert.equal(openApiGeneratedMatch.matchType, 'expected_output_path');

const openApiCounterpartMatch = index.match({
  importer: 'api/main.ts',
  specifier: './generated/openapi-client.ts'
});
assert.equal(openApiCounterpartMatch.matched, true);
assert.equal(openApiCounterpartMatch.source, 'index');
assert.equal(openApiCounterpartMatch.matchType, 'source_counterpart');
assert.equal(openApiCounterpartMatch.sourcePath, 'api/openapi.yaml');

const nonMatch = index.match({
  importer: 'src/main.js',
  specifier: './local/util.js'
});
assert.equal(nonMatch.matched, false);

const heuristicOnly = matchGeneratedExpectationSpecifier({
  importer: 'src/main.js',
  specifier: './generated/ghost.ts'
});
assert.equal(heuristicOnly.matched, true);
assert.equal(heuristicOnly.source, 'heuristic');

const indexedMatch = matchGeneratedExpectationSpecifier({
  importer: 'python/service/main.py',
  specifier: './proto/client_pb2.py',
  expectedArtifactsIndex: index
});
assert.equal(indexedMatch.matched, true);
assert.equal(indexedMatch.source, 'index');

console.log('expected artifacts index tests passed');
