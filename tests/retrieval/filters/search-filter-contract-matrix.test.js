#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const languageFixture = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const sampleFixture = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});

const runLanguageSearch = createInProcessSearchRunner({
  fixtureRoot: languageFixture.fixtureRoot,
  env: languageFixture.env
});
const runSampleSearch = createInProcessSearchRunner({
  fixtureRoot: sampleFixture.fixtureRoot,
  env: sampleFixture.env
});

const cases = [
  {
    name: 'behavioral returns filter',
    async run() {
      const payload = await runLanguageSearch({
        query: 'update',
        mode: 'code',
        args: ['--returns']
      });
      assert.ok((payload.code || []).length > 0);
    }
  },
  {
    name: 'behavioral async filter',
    async run() {
      const payload = await runLanguageSearch({
        query: 'load',
        mode: 'code',
        args: ['--async']
      });
      assert.ok((payload.code || []).length > 0);
    }
  },
  {
    name: 'control-flow branches filter exposes matching metadata',
    async run() {
      const payload = await runLanguageSearch({
        query: 'load',
        mode: 'code',
        args: ['--branches', '1']
      });
      const hits = payload.code || [];
      assert.ok(hits.length > 0);
      assert.ok(hits.some((hit) => (hit.docmeta?.controlFlow?.branches || 0) >= 1));
    }
  },
  {
    name: 'file selector supports regex file filters',
    async run() {
      const payload = await runLanguageSearch({
        query: 'buildAliases',
        mode: 'code',
        args: ['--file', '/javascript_advanced\\.js$/']
      });
      const hits = payload.code || [];
      assert.ok(hits.length > 0);
      assert.ok(hits.some((hit) => hit.file && hit.file.endsWith('javascript_advanced.js')));
    }
  },
  {
    name: 'ext filter narrows results to matching extension',
    async run() {
      const payload = await runSampleSearch({
        query: 'message',
        mode: 'code',
        args: ['--backend', 'memory', '--ext', '.py']
      });
      const hits = payload.code || [];
      assert.ok(hits.length > 0);
      assert.ok(hits.every((hit) => hit.ext === '.py'));
    }
  },
  {
    name: 'path filter narrows results to matching file path',
    async run() {
      const payload = await runSampleSearch({
        query: 'message',
        mode: 'code',
        args: ['--backend', 'memory', '--path', 'src/sample.py']
      });
      const hits = payload.code || [];
      assert.ok(hits.length > 0);
      assert.ok(hits.every((hit) => hit.file === 'src/sample.py'));
    }
  },
  {
    name: 'type filter returns matching declarations',
    async run() {
      const payload = await runSampleSearch({
        query: 'sayHello',
        mode: 'code',
        args: ['--backend', 'memory', '--type', 'MethodDeclaration']
      });
      assert.ok((payload.code || []).length > 0);
    }
  },
  {
    name: 'signature filter returns matching declarations',
    async run() {
      const payload = await runSampleSearch({
        query: 'sayHello',
        mode: 'code',
        args: ['--backend', 'memory', '--signature', 'func sayHello']
      });
      assert.ok((payload.code || []).length > 0);
    }
  },
  {
    name: 'decorator filter returns matching declarations',
    async run() {
      const payload = await runSampleSearch({
        query: 'sayHello',
        mode: 'code',
        args: ['--backend', 'memory', '--decorator', 'available']
      });
      assert.ok((payload.code || []).length > 0);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('retrieval search filter contract matrix test passed');
