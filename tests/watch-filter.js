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

assert.equal(
  isIndexablePath({ absPath: mdPath, root, ignoreMatcher, modes: ['extracted-prose'] }),
  false,
  'expected prose extension to be excluded for extracted-prose mode'
);

assert.equal(
  isIndexablePath({ absPath: jsPath, root, ignoreMatcher, modes: ['extracted-prose'] }),
  true,
  'expected code extension to be indexable for extracted-prose mode'
);

const dockerfilePath = path.join(root, 'Dockerfile');
assert.equal(
  isIndexablePath({ absPath: dockerfilePath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected special code filename to be indexable for code mode'
);

const dockerfileVariantPath = path.join(root, 'Dockerfile.dev');
assert.equal(
  isIndexablePath({ absPath: dockerfileVariantPath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected dockerfile variants to be indexable for code mode'
);

const makefileVariantPath = path.join(root, 'Makefile.in');
assert.equal(
  isIndexablePath({ absPath: makefileVariantPath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected makefile variants to be indexable for code mode'
);

const gnuMakefilePath = path.join(root, 'GNUmakefile');
assert.equal(
  isIndexablePath({ absPath: gnuMakefilePath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected GNUmakefile to be indexable for code mode'
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

const recordsRoot = path.join(root, 'triage', 'records');
const recordPath = path.join(recordsRoot, 'record.md');
assert.equal(
  isIndexablePath({ absPath: recordPath, root, recordsRoot, ignoreMatcher, modes: ['prose'] }),
  false,
  'expected records files to be excluded from prose mode'
);
assert.equal(
  isIndexablePath({ absPath: recordPath, root, recordsRoot, ignoreMatcher, modes: ['records'] }),
  true,
  'expected records files to be indexable for records mode'
);

console.log('watch filter test passed');
