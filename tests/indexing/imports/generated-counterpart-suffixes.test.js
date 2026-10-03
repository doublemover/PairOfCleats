#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  stripGrpcPbGeneratedBase,
  stripPbGeneratedBase
} from '../../../src/index/build/import-resolution/generated-counterpart-suffix.js';
import { createExpectedArtifactsIndex } from '../../../src/index/build/import-resolution.js';

assert.equal(stripGrpcPbGeneratedBase('proto/client.grpc.pb.ts'), 'proto/client');
assert.equal(stripGrpcPbGeneratedBase('proto/client.grpc.pb.d.ts'), 'proto/client');
assert.equal(stripGrpcPbGeneratedBase('proto/client.pb.ts'), 'proto/client.pb.ts');

assert.equal(stripPbGeneratedBase('proto/client.pb.ts'), 'proto/client');
assert.equal(stripPbGeneratedBase('proto/client.pb.d.ts'), 'proto/client');
assert.equal(stripPbGeneratedBase('proto/client.grpc.pb.ts'), 'proto/client.grpc');

const longGrpcSuffix = `proto/client.grpc.pb${'.'.repeat(4096)}ts`;
const longPbSuffix = `proto/client.pb${'.'.repeat(4096)}ts`;
assert.equal(
  stripGrpcPbGeneratedBase(longGrpcSuffix),
  'proto/client',
  'expected long grpc.pb suffix parsing to stay deterministic'
);
assert.equal(
  stripPbGeneratedBase(longPbSuffix),
  'proto/client',
  'expected long pb suffix parsing to stay deterministic'
);

const index = createExpectedArtifactsIndex({
  entries: ['proto/client.proto']
});
const grpcMatch = index.match({
  importer: 'src/main.ts',
  specifier: '../proto/client.grpc.pb................................ts'
});
assert.equal(grpcMatch.matched, true);
assert.equal(grpcMatch.sourcePath, 'proto/client.proto');

const pbMatch = index.match({
  importer: 'src/main.ts',
  specifier: '../proto/client.pb................................ts'
});
assert.equal(pbMatch.matched, true);
assert.equal(pbMatch.sourcePath, 'proto/client.proto');

console.log('generated counterpart suffix tests passed');
