#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-resolution-llvm-fixture-paths');

await fs.rm(tempRoot, { recursive: true, force: true });

const write = async (relPath, content = '') => {
  const absPath = path.join(tempRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
};

await write('llvm/unittests/CodeGen/AllocationOrderTest.cpp', '#include "../lib/CodeGen/AllocationOrder.h"\n');
await write('llvm/lib/CodeGen/AllocationOrder.h', '#pragma once\n');

await write('ci/monolithic-linux.sh', '. .ci/utils.sh\n');
await write('.ci/utils.sh', '#!/bin/sh\necho ok\n');

// Fixture files intentionally contain synthetic includes that should not
// surface as unresolved graph warnings.
await write(
  'clang/unittests/Frontend/PCHPreambleTest.cpp',
  '#include "//./header1.h"\n'
);
await write('clang/unittests/Frontend/header1.h', '#pragma once\n');
await write(
  'clang/unittests/Tooling/Syntax/TokensTest.cpp',
  '#include "./foo.h"\n'
);
await write('clang/unittests/Tooling/Syntax/foo.h', '#pragma once\n');
await write(
  'libc/utils/hdrgen/tests/expected_output/subdir/test.h',
  '#include "../__llvm-libc-common.h"\n#include "../llvm-libc-types/type_a.h"\n#include "../llvm-libc-types/type_b.h"\n'
);
await write('libc/utils/hdrgen/tests/expected_output/__llvm-libc-common.h', '#pragma once\n');
await write('libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_a.h', '#pragma once\n');
await write('libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_b.h', '#pragma once\n');

const entryPaths = [
  'llvm/unittests/CodeGen/AllocationOrderTest.cpp',
  'llvm/lib/CodeGen/AllocationOrder.h',
  'ci/monolithic-linux.sh',
  '.ci/utils.sh',
  'clang/unittests/Frontend/PCHPreambleTest.cpp',
  'clang/unittests/Frontend/header1.h',
  'clang/unittests/Tooling/Syntax/TokensTest.cpp',
  'clang/unittests/Tooling/Syntax/foo.h',
  'libc/utils/hdrgen/tests/expected_output/subdir/test.h',
  'libc/utils/hdrgen/tests/expected_output/__llvm-libc-common.h',
  'libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_a.h',
  'libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_b.h'
];

const entries = entryPaths.map((rel) => ({ abs: path.join(tempRoot, rel), rel }));
const importsByFile = {
  'llvm/unittests/CodeGen/AllocationOrderTest.cpp': ['../lib/CodeGen/AllocationOrder.h'],
  'ci/monolithic-linux.sh': ['.ci/utils.sh'],
  'clang/unittests/Frontend/PCHPreambleTest.cpp': ['//./header1.h'],
  'clang/unittests/Tooling/Syntax/TokensTest.cpp': ['./foo.h'],
  'libc/utils/hdrgen/tests/expected_output/subdir/test.h': [
    '../__llvm-libc-common.h',
    '../llvm-libc-types/type_a.h',
    '../llvm-libc-types/type_b.h'
  ]
};

const relations = new Map(
  Object.entries(importsByFile).map(([file, imports]) => [file, { imports: imports.slice() }])
);

const result = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: true
});

assert.deepEqual(
  relations.get('llvm/unittests/CodeGen/AllocationOrderTest.cpp')?.importLinks || [],
  ['llvm/lib/CodeGen/AllocationOrder.h'],
  'expected llvm unittests ../lib include to resolve to project-root lib path'
);
assert.deepEqual(
  relations.get('ci/monolithic-linux.sh')?.importLinks || [],
  ['ci/utils.sh'],
  'expected .ci path import to resolve from repo root'
);
assert.deepEqual(
  relations.get('clang/unittests/Frontend/PCHPreambleTest.cpp')?.importLinks || [],
  ['clang/unittests/Frontend/header1.h'],
  'expected //./ include form to resolve against importer directory'
);
assert.deepEqual(
  relations.get('clang/unittests/Tooling/Syntax/TokensTest.cpp')?.importLinks || [],
  ['clang/unittests/Tooling/Syntax/foo.h'],
  'expected ./ include form to resolve against importer directory'
);
assert.deepEqual(
  relations.get('libc/utils/hdrgen/tests/expected_output/subdir/test.h')?.importLinks || [],
  [
    'libc/utils/hdrgen/tests/expected_output/__llvm-libc-common.h',
    'libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_a.h',
    'libc/utils/hdrgen/tests/expected_output/llvm-libc-types/type_b.h'
  ],
  'expected libc relative includes to resolve within expected_output fixture tree'
);
assert.equal(
  (result?.graph?.warnings || []).length,
  0,
  'expected fixture-only unresolved imports to be suppressed'
);

console.log('import resolution llvm fixture path test passed');
