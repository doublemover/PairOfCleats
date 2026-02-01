#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSerializedFilterIndex } from '../src/index/build/artifacts/filter-index.js';

const chunk = {
  id: 0,
  file: 'src/example.js',
  lang: 'javascript'
};

const resolvedConfig = {
  chargramMinN: 3
};

const runWithToken = (token) => {
  if (token === null) {
    delete process.env.PAIROFCLEATS_API_TOKEN;
  } else {
    process.env.PAIROFCLEATS_API_TOKEN = token;
  }
  const result = buildSerializedFilterIndex({
    chunks: [chunk],
    resolvedConfig,
    userConfig: {},
    root: process.cwd()
  });
  return result.configHash;
};

const prevToken = process.env.PAIROFCLEATS_API_TOKEN;

try {
  const hashA = runWithToken('token-a');
  const hashB = runWithToken('token-b');
  assert.ok(hashA, 'expected configHash to be populated');
  assert.equal(hashA, hashB, 'configHash should ignore apiToken changes');
} finally {
  if (prevToken === undefined) {
    delete process.env.PAIROFCLEATS_API_TOKEN;
  } else {
    process.env.PAIROFCLEATS_API_TOKEN = prevToken;
  }
}

console.log('filter index configHash token test passed');
