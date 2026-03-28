#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import {
  mergeExtFilters,
  mergeLangFilters,
  normalizeExtFilter,
  normalizeLangFilter
} from '../../../src/retrieval/filters.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { ensureSearchFiltersRepo, runFilterSearch } from '../../helpers/search-filters-repo.js';

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
const filterRepoContext = await ensureSearchFiltersRepo();
if (!filterRepoContext) process.exit(0);

const { repoRoot: filterRepoRoot, env: filterRepoEnv } = filterRepoContext;
const extractFiles = (payload, key = 'prose') => new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const cases = [
  {
    name: 'ext filter normalization lowercases and dedupes extensions',
    async run() {
      const result = normalizeExtFilter(['*.js', 'JS', '.Md']);
      assert.deepEqual((result || []).slice().sort(), ['.js', '.md']);
    }
  },
  {
    name: 'lang filter normalization and merging preserve canonical values',
    async run() {
      const js = normalizeLangFilter('js');
      assert.ok(js && js.includes('javascript'));

      const mixed = normalizeLangFilter('ts,python');
      assert.ok(mixed && mixed.includes('typescript'));
      assert.ok(mixed && mixed.includes('python'));

      const extFilterInfo = mergeExtFilters(['.ts'], ['.tsx']);
      assert.equal(extFilterInfo.impossible, true);
      assert.equal(extFilterInfo.values, null);

      const langFilterInfo = mergeLangFilters(normalizeLangFilter('typescript'), normalizeLangFilter('ts'));
      assert.equal(langFilterInfo.impossible, false);
      assert.deepEqual(langFilterInfo.values, ['typescript']);

      const unknown = normalizeLangFilter('unknown');
      assert.ok(unknown && unknown.includes('unknown'));
    }
  },
  {
    name: 'file filter case sensitivity preserves strict versus loose matches',
    async run() {
      const chunkMeta = [
        { id: 0, file: 'src/Foo.js', ext: '.js', metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } } },
        { id: 1, file: 'src/foo.js', ext: '.js', metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } } }
      ];
      const filterIndex = buildFilterIndex(chunkMeta, { fileChargramN: 3 });

      const strictHits = filterChunks(chunkMeta, {
        file: 'Foo.js',
        caseFile: true,
        filePrefilter: { enabled: true, chargramN: 3 }
      }, filterIndex);
      assert.equal(strictHits.length, 1);
      assert.equal(strictHits[0].file, 'src/Foo.js');

      const looseHits = filterChunks(chunkMeta, {
        file: 'Foo.js',
        caseFile: false,
        filePrefilter: { enabled: true, chargramN: 3 }
      }, filterIndex);
      assert.equal(looseHits.length, 2);
    }
  },
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
  },
  {
    name: 'negative token and phrase syntax filters prose hits',
    async run() {
      const negativeToken = runFilterSearch({ repoRoot: filterRepoRoot, env: filterRepoEnv, query: 'alpha -gamma' });
      const negativeTokenFiles = extractFiles(negativeToken);
      assert.equal(negativeTokenFiles.has('alpha.txt'), true);
      assert.equal(negativeTokenFiles.has('beta.txt'), false);

      const negativePhrase = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha -"alpha beta"'
      });
      const negativePhraseFiles = extractFiles(negativePhrase);
      assert.equal(negativePhraseFiles.has('beta.txt'), true);
      assert.equal(negativePhraseFiles.has('alpha.txt'), false);
    }
  },
  {
    name: 'quoted phrase explain output carries phrase score breakdown',
    async run() {
      const phraseSearch = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: '"alpha beta"',
        args: ['--explain']
      });
      const phraseHits = phraseSearch.prose || [];
      assert.ok(phraseHits.length > 0);
      assert.equal((phraseHits[0]?.scoreBreakdown?.phrase?.matches || 0) > 0, true);
    }
  },
  {
    name: 'git metadata branch and chunk-author filters narrow prose hits correctly',
    async run() {
      if (!filterRepoContext.branchName) {
        return;
      }

      const branchMatch = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--branch', filterRepoContext.branchName]
      });
      assert.ok((branchMatch.prose || []).length > 0);

      const branchMiss = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--branch', 'no-such-branch']
      });
      assert.equal((branchMiss.prose || []).length, 0);

      const chunkAuthorAlice = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--chunk-author', 'Alice']
      });
      const aliceFiles = extractFiles(chunkAuthorAlice);
      assert.equal(aliceFiles.has('alpha.txt'), true);
      assert.equal(aliceFiles.has('beta.txt'), false);

      const chunkAuthorBob = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--chunk-author', 'Bob']
      });
      const bobFiles = extractFiles(chunkAuthorBob);
      assert.equal(bobFiles.has('beta.txt'), true);
      assert.equal(bobFiles.has('alpha.txt'), false);
    }
  },
  {
    name: 'churn filter accepts numeric thresholds and rejects invalid values',
    async run() {
      const defaultPayload = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha'
      });
      assert.ok((defaultPayload.prose || []).length > 0);

      const zeroPayload = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--churn', '0']
      });
      assert.ok((zeroPayload.prose || []).length > 0);

      const highPayload = runFilterSearch({
        repoRoot: filterRepoRoot,
        env: filterRepoEnv,
        query: 'alpha',
        args: ['--churn', '999999']
      });
      assert.equal((highPayload.prose || []).length, 0);

      const invalidResult = spawnSync(
        process.execPath,
        [
          path.join(filterRepoContext.root, 'search.js'),
          'alpha',
          '--mode',
          'prose',
          '--json',
          '--no-ann',
          '--repo',
          filterRepoRoot,
          '--backend',
          'memory',
          '--churn',
          'not-a-number'
        ],
        {
          cwd: filterRepoRoot,
          env: filterRepoEnv,
          encoding: 'utf8',
          timeout: 2 * 60 * 1000
        }
      );
      assert.notEqual(invalidResult.status, 0);
      assert.match(`${invalidResult.stdout || ''}\n${invalidResult.stderr || ''}`, /churn/i);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('retrieval search filter contract matrix test passed');
