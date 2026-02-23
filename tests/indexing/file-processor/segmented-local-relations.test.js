#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFileProcessor } from '../../../src/index/build/file-processor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'segmented-local-relations');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const sveltePath = path.join(repoRoot, 'src', 'Widget.svelte');
const svelteText = [
  '<script context=\"module\">',
  "import { config } from './config';",
  '</script>',
  '<script>',
  "import Card from './Card.svelte';",
  'const value = config;',
  '</script>',
  '<div>{value}</div>'
].join('\n');
await fs.writeFile(sveltePath, svelteText, 'utf8');

const vuePath = path.join(repoRoot, 'src', 'App.vue');
const vueText = [
  '<template><Card /></template>',
  '<script lang=\"ts\">',
  "import { boot } from './boot';",
  '</script>',
  '<script setup lang=\"ts\">',
  "import Card from './Card.vue';",
  'boot();',
  '</script>'
].join('\n');
await fs.writeFile(vuePath, vueText, 'utf8');

const astroPath = path.join(repoRoot, 'src', 'Page.astro');
const astroText = [
  '---',
  "import Layout from './Layout.astro';",
  "import { dateLabel } from './date';",
  '---',
  '<script>',
  "import hydrate from './client.js';",
  '</script>',
  '<Layout>{dateLabel()}</Layout>'
].join('\n');
await fs.writeFile(astroPath, astroText, 'utf8');

const { processFile } = createFileProcessor({
  root: repoRoot,
  mode: 'code',
  dictConfig: {},
  dictWords: new Set(),
  languageOptions: {
    skipUnknownLanguages: false,
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    treeSitter: { enabled: false }
  },
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  contextWin: 0,
  incrementalState: {
    enabled: false,
    manifest: { files: {} },
    bundleDir: '',
    bundleFormat: 'json'
  },
  getChunkEmbedding: async () => null,
  getChunkEmbeddings: async () => null,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  relationsEnabled: true,
  seenFiles: new Set(),
  gitBlameEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  structuralMatches: null,
  cacheConfig: {},
  cacheReporter: null,
  queues: null,
  workerPool: null,
  crashLogger: null,
  skippedFiles: [],
  embeddingEnabled: false,
  tokenizeEnabled: false,
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
  tokenizationStats: null
});

const processAndCollectImports = async (absPath, relPath, text) => {
  const stat = await fs.stat(absPath);
  const fileEntry = {
    abs: absPath,
    rel: relPath,
    stat,
    lines: text.split('\n').length,
    scan: { checkedBinary: true, checkedMinified: true }
  };
  const out = await processFile(fileEntry, 0);
  assert.ok(out?.chunks?.length, `expected chunks for ${relPath}`);
  const imports = new Set();
  for (const chunk of out.chunks) {
    for (const spec of chunk?.codeRelations?.imports || []) {
      imports.add(spec);
    }
  }
  return imports;
};

const svelteImports = await processAndCollectImports(sveltePath, 'src/Widget.svelte', svelteText);
assert.equal(svelteImports.has('./config'), true, 'expected module-script import from segmented svelte file');
assert.equal(svelteImports.has('./Card.svelte'), true, 'expected instance-script import from segmented svelte file');

const vueImports = await processAndCollectImports(vuePath, 'src/App.vue', vueText);
assert.equal(vueImports.has('./boot'), true, 'expected classic-script import from segmented vue file');
assert.equal(vueImports.has('./Card.vue'), true, 'expected script-setup import from segmented vue file');

const astroImports = await processAndCollectImports(astroPath, 'src/Page.astro', astroText);
assert.equal(astroImports.has('./Layout.astro'), true, 'expected frontmatter component import from segmented astro file');
assert.equal(astroImports.has('./date'), true, 'expected frontmatter module import from segmented astro file');
assert.equal(astroImports.has('./client.js'), true, 'expected embedded script import from segmented astro file');

console.log('segmented local relations test passed');
