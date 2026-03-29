#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildPythonHeuristicChunks,
  collectPythonImports,
  getPythonAst,
  shutdownPythonAstPool
} from '../../../src/lang/python.js';
const hasPython = () => {
  for (const cmd of ['python', 'python3']) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
};

const sorted = (items) => items.slice().sort();
const expectSet = (label, actual, expected) => {
  assert.deepEqual(sorted(actual), sorted(expected), `${label} mismatch`);
};

const cases = [
  {
    name: 'python import collection is deterministic and ignores docstrings',
    async run() {
      const source = [
        'import Foo, foo',
        'import os, sys as system',
        'import json',
        'from collections import defaultdict, namedtuple as nt',
        'from . import sibling',
        'from ..pkg.sub import Util as UtilAlias',
        'from foo.bar import Baz as Qux, Quux',
        '# from ignored import nope'
      ].join('\n');

      const { imports, usages } = collectPythonImports(source);
      expectSet('imports+relative', imports, ['Foo', 'foo', 'os', 'sys', 'json', 'collections', '.', '..pkg.sub', 'foo.bar']);
      expectSet('usages', usages, ['sibling', 'Util', 'UtilAlias', 'system', 'defaultdict', 'namedtuple', 'nt', 'Baz', 'Qux', 'Quux']);
      assert.deepEqual(imports, imports.slice().sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()) || String(a).localeCompare(String(b))));

      const docstringSample = collectPythonImports([
        '"""',
        'Example:',
        '    from fake.docs import ExampleThing',
        '    import pretend_module',
        '"""',
        'from real.pkg import ActualThing as AliasThing',
        'import json',
        'guide = """',
        'import another_fake',
        '"""',
        'from feature.flags import (',
        '    EnabledFeature,',
        '    DisabledFeature as DF,',
        ')'
      ].join('\n'));

      expectSet('docstring imports filtered', docstringSample.imports, ['feature.flags', 'json', 'real.pkg']);
      expectSet('docstring usages filtered', docstringSample.usages, ['ActualThing', 'AliasThing', 'DF', 'DisabledFeature', 'EnabledFeature']);
    }
  },
  {
    name: 'python heuristic chunking covers representative fixtures and local samples',
    async run() {
      const sample = [
        'class Foo:',
        '    def method(self):',
        '        pass',
        '',
        'def top():',
        '    pass',
        '',
        'async def later():',
        '    pass'
      ].join('\n');

      const chunks = buildPythonHeuristicChunks(sample) || [];
      const byName = Object.fromEntries(chunks.map((chunk) => [chunk.name, chunk]));
      assert.ok(byName.Foo);
      assert.ok(byName['Foo.method']);
      assert.ok(byName.top);
      assert.ok(byName.later);
      assert.equal(byName.Foo.meta.startLine, 1);
      assert.equal(byName.Foo.meta.endLine, 4);
      assert.equal(byName['Foo.method'].meta.startLine, 2);
      assert.equal(byName['Foo.method'].meta.endLine, 4);

      const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'languages', 'src', 'python_advanced.py');
      const text = fs.readFileSync(fixturePath, 'utf8');
      const fixtureChunks = buildPythonHeuristicChunks(text) || [];
      const names = new Set(fixtureChunks.map((chunk) => chunk.name));
      assert.ok(names.has('Point'));
      assert.ok(names.has('Point.distance'));
      assert.ok(names.has('outer'));
      assert.ok(names.has('fetch_data'));
    }
  },
  {
    name: 'python ast pool fails open when python is unavailable',
    async run() {
      const failOpenScript = [
        "import assert from 'node:assert/strict';",
        "import { getPythonAst, shutdownPythonAstPool } from './src/lang/python.js';",
        "const ast = await getPythonAst('def add(a, b):\\n    return a + b\\n', null, { pythonAst: { workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 } });",
        'assert.equal(ast, null);',
        'await shutdownPythonAstPool();'
      ].join('\n');
      const failOpen = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', failOpenScript],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: ''
          }
        }
      );
      assert.equal(failOpen.status, 0, failOpen.stderr || failOpen.stdout || 'python fail-open subprocess failed');
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('python contract matrix test passed');
