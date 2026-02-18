#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFrameworkProfileResolver } from '../../../src/index/build/file-processor/process-chunks/index.js';

let calls = 0;
const resolver = createFrameworkProfileResolver({
  relPath: 'src/components/Button.tsx',
  text: "import React from 'react';\nexport const Button = () => <button />;",
  detect: ({ ext }) => {
    calls += 1;
    if (ext === '.tsx') {
      return { id: 'react', confidence: 'heuristic', signals: { reactHydrationBoundary: false } };
    }
    return null;
  }
});

const firstTsx = resolver({ ext: '.tsx' });
const secondTsx = resolver({ ext: '.tsx' });
assert.equal(calls, 1, 'expected framework detection to be cached per extension');
assert.equal(firstTsx, secondTsx, 'expected cached framework profile object to be reused');

const firstMdx = resolver({ ext: '.mdx' });
const secondMdx = resolver({ ext: '.mdx' });
assert.equal(calls, 2, 'expected one detection call for each unique extension');
assert.equal(firstMdx, null);
assert.equal(secondMdx, null);

console.log('framework profile resolver cache test passed');
