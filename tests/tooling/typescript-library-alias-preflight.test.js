import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { collectCompilerDependencyInventory, verifyCompilerDependencyInventory } from '../../src/index/semantic/compiler-dependencies.js';
import { createVirtualCompilerHost } from '../../src/index/tooling/typescript/host.js';

const { dir: root } = await prepareIsolatedTestCacheDir('typescript-library-alias');
await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  target: 'ESNext', lib: ['esnext'], types: [], skipLibCheck: true
}, files: ['main.ts'] }));
await fs.writeFile(path.join(root, 'main.ts'), '/// <reference lib="esnext.float16" />\nexport function accept(value: Float16Array) { return value; }\n');
const toolingConfig = { typescript: {} };
const inventory = await collectCompilerDependencyInventory({ repoRoot: root, toolingConfig, files: ['main.ts'] });
const { ts, system } = await verifyCompilerDependencyInventory({ inventory, repoRoot: root, toolingConfig });
const canonicalLibrary = ts.libMap.get('esnext.float16');
assert.ok(canonicalLibrary && canonicalLibrary !== 'lib.esnext.float16.d.ts', 'the compiler owns a nonliteral library alias');
assert.ok(inventory.closure.files.some(file => path.basename(file.path) === canonicalLibrary));
const group = inventory.groups[0], key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const host = createVirtualCompilerHost(ts, group.options, new Map(), new Map(), new Map(), system);
const program = ts.createProgram({ rootNames: group.rootNames, options: group.options, host });
program.getTypeChecker();
for (const source of program.getSourceFiles()) {
  const hash = createHash('sha256').update(source.text).digest('hex');
  assert.ok(inventory.closure.files.some(file => key(file.path) === key(source.fileName) && file.hash === hash),
    'actual sealed Program inputs retain their exact admitted source identity');
}
assert.throws(() => system.readFile(path.join(root, 'unsealed.ts')), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
console.log('The installed compiler library alias map seals the same files consumed by its actual Program.');
