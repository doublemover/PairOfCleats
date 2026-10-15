import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectNativeIncludeProbes } from '../../../src/index/semantic/native-task-authority.js';

// Dependency-free source-authority regression; this does not qualify clangd.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-include-closure-'));
try {
  const repoRoot = path.join(root, 'repo'); await fs.mkdir(repoRoot);
  const file = path.join(repoRoot, 'main.c'), header = path.join(repoRoot, 'value.h');
  await fs.writeFile(file, ''); await fs.writeFile(header, '#define VALUE 1\n');
  const entries = [{ file, includeRoots: [] }], present = new Set([file, header]);
  const collect = textByPath => collectNativeIncludeProbes({ repoRoot, entries, present, textByPath });
  const accepted = await collect(new Map([[file, '#include "value.h"\n'], [header, '#define VALUE 1\n']]));
  assert.deepEqual(accepted, [{ path: header, exists: true }]);
  for (const text of ['%:include "../outside.h"\n', '%:include "value.h"\n']) {
    await assert.rejects(collect(new Map([[file, text], [header, '#define VALUE 1\n']])),
      { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  }
  for (const name of ['inner.def', 'HEADER.H', 'no-extension']) {
    const included = path.join(repoRoot, name);
    await fs.writeFile(included, '#include "../outside.h"\n'); present.add(included);
    await assert.rejects(collect(new Map([[file, '#include "' + name + '"\n'], [header, '#define VALUE 1\n']])),
      { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' }, 'an unscanned included file cannot seal an external dependency');
  }
  await assert.rejects(collect(new Map([[file, '#include "value.h"\n'], [header, '#include "../outside.h"\n']])),
    { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(collectNativeIncludeProbes({ repoRoot, entries, present, textByPath: new Map([[file, '']]), signal: aborted.signal }),
    { name: 'AbortError' });
  console.log('Native include closure rejects digraph directives and unscanned included files before toolchain admission');
} finally { await fs.rm(root, { recursive: true, force: true }); }
