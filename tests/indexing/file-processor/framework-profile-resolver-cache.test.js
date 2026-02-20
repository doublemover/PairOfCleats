#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFrameworkProfileResolver } from '../../../src/index/build/file-processor/process-chunks/index.js';

let calls = 0;
const seenExts = [];
const resolver = createFrameworkProfileResolver({
  relPath: 'src/components/Button.tsx',
  ext: '.vue',
  text: "import React from 'react';\nexport const Button = () => <button />;",
  detect: ({ ext }) => {
    calls += 1;
    seenExts.push(ext);
    if (ext === '.vue') {
      return { id: 'vue', confidence: 'heuristic', signals: { vueSfcScriptSetupBindings: false } };
    }
    return null;
  }
});

const firstSegment = resolver({ ext: '.js' });
const secondSegment = resolver({ ext: '.css' });
assert.equal(calls, 1, 'expected framework detection to run once per container file');
assert.equal(firstSegment, secondSegment, 'expected cached framework profile object to be reused');
assert.deepEqual(seenExts, ['.vue'], 'expected resolver to detect framework using container extension');

console.log('framework profile resolver cache test passed');
