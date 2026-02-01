#!/usr/bin/env node
import { resolveRelativeImport } from '../../src/index/type-inference-crossfile/resolve-relative-import.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const fileSet = new Set([
  'src/lib.js',
  'src/util/index.tsx',
  'src/helpers.mjs'
]);

const direct = resolveRelativeImport('src/app.js', './lib', fileSet);
if (direct !== 'src/lib.js') {
  fail(`Expected ./lib to resolve to src/lib.js, got ${direct}`);
}

const indexResolved = resolveRelativeImport('src/app.js', './util', fileSet);
if (indexResolved !== 'src/util/index.tsx') {
  fail(`Expected ./util to resolve to src/util/index.tsx, got ${indexResolved}`);
}

const withExt = resolveRelativeImport('src/app.js', './helpers.mjs', fileSet);
if (withExt !== 'src/helpers.mjs') {
  fail(`Expected ./helpers.mjs to resolve to src/helpers.mjs, got ${withExt}`);
}

const nonRelative = resolveRelativeImport('src/app.js', 'react', fileSet);
if (nonRelative !== null) {
  fail('Expected non-relative imports to return null.');
}

const invalidSet = resolveRelativeImport('src/app.js', './lib', null);
if (invalidSet !== null) {
  fail('Expected missing fileSet to return null.');
}

console.log('resolve-relative-import tests passed');
