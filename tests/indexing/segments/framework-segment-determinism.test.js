#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { discoverSegments } from '../../../src/index/segments.js';

applyTestEnv();

const assertStableSegments = (input, label) => {
  const first = discoverSegments(input);
  const second = discoverSegments(input);
  assert.deepEqual(second, first, `expected deterministic segment output for ${label}`);
  let lastStart = -1;
  for (const segment of first) {
    assert.ok(segment.start >= 0 && segment.end > segment.start, `${label} segment range invalid`);
    assert.ok(segment.start >= lastStart, `${label} segments should be ordered by start offset`);
    lastStart = segment.start;
  }
  return first;
};

const vueText = [
  '<template><main>{{ title }}</main></template>',
  '<script lang=\"ts\">export const title: string = \"Widget\";</script>',
  '<script setup lang=\"ts\">import { ref } from \"vue\"; const count = ref(0);</script>',
  '<style scoped>.root { color: #111; }</style>'
].join('\n');

const vueSegments = assertStableSegments({
  text: vueText,
  ext: '.vue',
  relPath: 'src/App.vue',
  mode: 'code'
}, 'vue');
assert.equal(vueSegments.some((segment) => segment.meta?.block === 'template' && segment.languageId === 'html'), true);
assert.equal(vueSegments.some((segment) => segment.meta?.block === 'script' && segment.languageId === 'typescript'), true);
assert.equal(vueSegments.some((segment) => segment.meta?.block === 'scriptSetup' && segment.languageId === 'typescript'), true);
assert.equal(vueSegments.some((segment) => segment.meta?.block === 'style' && segment.languageId === 'css'), true);

const svelteText = [
  '<script context=\"module\" lang=\"ts\">',
  'import { seed } from \"./seed\";',
  '</script>',
  '<script lang=\"ts\">',
  'import { writable } from \"svelte/store\";',
  'const count = writable(seed);',
  '</script>',
  '<style>.card { padding: 4px; }</style>',
  '<div class=\"card\">{ $count }</div>'
].join('\n');

const svelteSegments = assertStableSegments({
  text: svelteText,
  ext: '.svelte',
  relPath: 'src/Widget.svelte',
  mode: 'code'
}, 'svelte');
assert.equal(svelteSegments.some((segment) => segment.meta?.block === 'scriptModule' && segment.languageId === 'typescript'), true);
assert.equal(svelteSegments.some((segment) => segment.meta?.block === 'script' && segment.languageId === 'typescript'), true);
assert.equal(svelteSegments.some((segment) => segment.meta?.block === 'template' && segment.languageId === 'html'), true);
assert.equal(svelteSegments.some((segment) => segment.meta?.block === 'style' && segment.languageId === 'css'), true);

const astroText = [
  '---',
  'const title = \"Astro\";',
  '---',
  '<style lang=\"scss\">.hero { color: #111; }</style>',
  '<script lang=\"ts\">console.log(title);</script>',
  '<main class=\"hero\">{title}</main>'
].join('\n');

const astroSegments = assertStableSegments({
  text: astroText,
  ext: '.astro',
  relPath: 'src/pages/index.astro',
  mode: 'code'
}, 'astro');
assert.equal(astroSegments.some((segment) => segment.meta?.block === 'frontmatter' && segment.languageId === 'javascript'), true);
assert.equal(astroSegments.some((segment) => segment.meta?.block === 'script' && segment.languageId === 'typescript'), true);
assert.equal(astroSegments.some((segment) => segment.meta?.block === 'style' && segment.languageId === 'scss'), true);
assert.equal(astroSegments.some((segment) => segment.meta?.block === 'template' && segment.languageId === 'html'), true);

console.log('framework segment determinism test passed');
