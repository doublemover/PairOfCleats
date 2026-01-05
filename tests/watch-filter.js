import assert from 'node:assert/strict';
import path from 'node:path';
import ignore from 'ignore';
import { isIndexablePath } from '../src/index/build/watch.js';

const root = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
const ignoreMatcher = ignore().add(['ignored/']);

const jsPath = path.join(root, 'src', 'app.js');
assert.equal(
  isIndexablePath({ absPath: jsPath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected code extension to be indexable for code mode'
);

const mdPath = path.join(root, 'docs', 'readme.md');
assert.equal(
  isIndexablePath({ absPath: mdPath, root, ignoreMatcher, modes: ['prose'] }),
  true,
  'expected prose extension to be indexable for prose mode'
);

assert.equal(
  isIndexablePath({ absPath: mdPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected prose extension to be excluded for code-only mode'
);

const dockerfilePath = path.join(root, 'Dockerfile');
assert.equal(
  isIndexablePath({ absPath: dockerfilePath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected special code filename to be indexable for code mode'
);

const ignoredPath = path.join(root, 'ignored', 'app.js');
assert.equal(
  isIndexablePath({ absPath: ignoredPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected ignored path to be excluded'
);

const outsidePath = path.join(root, '..', 'outside', 'file.js');
assert.equal(
  isIndexablePath({ absPath: outsidePath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected path outside root to be excluded'
);

const mixedModesPath = path.join(root, 'content', 'story.md');
assert.equal(
  isIndexablePath({ absPath: mixedModesPath, root, ignoreMatcher, modes: ['code', 'prose'] }),
  true,
  'expected prose extension to be indexable when prose mode is enabled'
);

console.log('watch filter test passed');
