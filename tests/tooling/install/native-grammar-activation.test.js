import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeNativeGrammarRoutes } from '../../../src/shared/native-package-probe.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-grammar-activation-'));
const write = (relative, text) => {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
try {
  write('package.json', '{"type":"module"}');
  write('src/lang/tree-sitter/native-grammar-binding.js',
    fs.readFileSync(new URL('../../../src/lang/tree-sitter/native-grammar-binding.js', import.meta.url)));
  for (const name of ['tree-sitter', 'fixture-grammar']) {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }));
  }
  write('node_modules/fixture-grammar/index.cjs', 'module.exports = { language: {}, nodeTypeInfo: [] };');
  const routes = [{ languageId: 'fixture', moduleName: 'fixture-grammar', source: 'value = 1' }];
  write('node_modules/tree-sitter/index.cjs', 'module.exports = class { setLanguage(){throw Error("ABI mismatch")} };');
  const failed = probeNativeGrammarRoutes(root, routes);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.capabilities, []);
  assert.match(failed.message, /ABI mismatch/);
  write('node_modules/tree-sitter/index.cjs',
    'module.exports = class { setLanguage(){} parse(){return {rootNode:{hasError:false}}} };');
  const activated = probeNativeGrammarRoutes(root, routes);
  assert.equal(activated.ok, true, activated.message);
  assert.equal(activated.capabilities[0].state, 'parser-activated');
  assert.equal(activated.capabilities[0].packageVersion, '1.0.0');
  assert.equal(activated.capabilities[0].nodeVersion, process.version);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('native grammar activation capability test passed');
