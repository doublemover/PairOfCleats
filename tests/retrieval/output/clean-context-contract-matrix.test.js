#!/usr/bin/env node
import assert from 'node:assert/strict';

import { cleanContext } from '../../../src/retrieval/output/context.js';

const cases = [
  {
    name: 'removes fence lines while preserving code',
    run() {
      const lines = [
        '```ts',
        'const x = 1;',
        '```',
        '',
        'function test() {}'
      ];
      const cleaned = cleanContext(lines);
      assert.equal(cleaned.some((line) => line.includes('```')), false);
      assert.equal(cleaned.some((line) => line.includes('const x = 1')), true);
    }
  },
  {
    name: 'drops non-string entries safely',
    run() {
      const cleaned = cleanContext([null, 42, 'ok line', { foo: 'bar' }, '```', 'another line']);
      assert.deepEqual(cleaned, ['ok line', 'another line']);
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('clean context contract matrix test passed');
