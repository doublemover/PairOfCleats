import assert from 'node:assert/strict';
import path from 'node:path';
import ignore from 'ignore';
import { isIndexablePath } from '../../../src/index/build/watch.js';

const root = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
const ignoreMatcher = ignore().add(['ignored/']);

const jsPath = path.join(root, 'src', 'app.js');
assert.equal(
  isIndexablePath({ absPath: jsPath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected code extension to be indexable for code mode'
);

const mdPath = path.join(root, 'docs', 'readme.md');
const docsHtmlPath = path.join(root, 'docs', 'reference', 'index.html');
const docsJsPath = path.join(root, 'docs', 'reference', 'site.js');
const docsJsonPath = path.join(root, 'docs', 'reference', 'search.json');
const docsCssPath = path.join(root, 'docs', 'reference', 'site.css');
const srcHtmlPath = path.join(root, 'src', 'site', 'index.html');
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
  true,
  'expected prose extension to be indexable for extracted-prose mode'
);

assert.equal(
  isIndexablePath({ absPath: jsPath, root, ignoreMatcher, modes: ['extracted-prose'] }),
  true,
  'expected code extension to be indexable for extracted-prose mode'
);

assert.equal(
  isIndexablePath({ absPath: docsHtmlPath, root, ignoreMatcher, modes: ['prose'] }),
  true,
  'expected docs html to be indexable for prose mode'
);

assert.equal(
  isIndexablePath({ absPath: docsHtmlPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected docs html to be excluded for code mode'
);

assert.equal(
  isIndexablePath({ absPath: docsHtmlPath, root, ignoreMatcher, modes: ['extracted-prose'] }),
  true,
  'expected docs html to be indexable for extracted-prose mode'
);
assert.equal(
  isIndexablePath({ absPath: docsJsPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected docs js to be excluded for code mode'
);
assert.equal(
  isIndexablePath({ absPath: docsJsonPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected docs json to be excluded for code mode'
);
assert.equal(
  isIndexablePath({ absPath: docsCssPath, root, ignoreMatcher, modes: ['code'] }),
  false,
  'expected docs css to be excluded for code mode'
);
assert.equal(
  isIndexablePath({ absPath: docsJsPath, root, ignoreMatcher, modes: ['prose'] }),
  true,
  'expected docs js to be indexable for prose mode'
);
assert.equal(
  isIndexablePath({ absPath: docsJsonPath, root, ignoreMatcher, modes: ['prose'] }),
  true,
  'expected docs json to be indexable for prose mode'
);
assert.equal(
  isIndexablePath({ absPath: docsCssPath, root, ignoreMatcher, modes: ['prose'] }),
  true,
  'expected docs css to be indexable for prose mode'
);

assert.equal(
  isIndexablePath({ absPath: srcHtmlPath, root, ignoreMatcher, modes: ['code'] }),
  true,
  'expected non-docs html to remain indexable for code mode'
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
