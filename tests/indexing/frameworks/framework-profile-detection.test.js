#!/usr/bin/env node
import assert from 'node:assert/strict';
import { detectFrameworkProfile } from '../../../src/index/framework-profile.js';

const CASES = [
  {
    relPath: 'src/components/Button.tsx',
    ext: '.tsx',
    text: "import React from 'react';\nexport function Button(){ return <button/>; }",
    expectedId: 'react',
    expectedSignal: null
  },
  {
    relPath: 'src/components/App.vue',
    ext: '.vue',
    text: '<template><div /></template>\n<script setup>const x = 1</script>\n<style scoped></style>',
    expectedId: 'vue',
    expectedSignal: 'vueSfcScriptSetupBindings'
  },
  {
    relPath: 'app/blog/[slug]/page.tsx',
    ext: '.tsx',
    text: "'use client'\nexport default function Page(){ return null; }",
    expectedId: 'next',
    expectedSignal: 'nextAppRouterDynamicSegment'
  },
  {
    relPath: 'app/blog/page.tsx',
    ext: '.tsx',
    text: "import React from 'react';\nexport default function BlogPage(){ return <section />; }",
    expectedId: 'react',
    expectedSignal: null
  },
  {
    relPath: 'src/pages/index.tsx',
    ext: '.tsx',
    text: "import Link from 'next/link';\nexport default function Home(){ return <Link href='/' />; }",
    expectedId: 'next',
    expectedSignal: 'nextPagesRouterRoute'
  },
  {
    relPath: 'src/pages/account.tsx',
    ext: '.tsx',
    text: "import React from 'react';\nexport default function Account(){ return <main />; }",
    expectedId: 'react',
    expectedSignal: null
  },
  {
    relPath: 'src/app/dashboard/widgets.tsx',
    ext: '.tsx',
    text: "import React from 'react';\nexport const Widgets = () => <section />;",
    expectedId: 'react',
    expectedSignal: null
  },
  {
    relPath: 'pages/users/[id].vue',
    ext: '.vue',
    text: '<template><NuxtPage /></template>\n<style scoped></style>',
    expectedId: 'nuxt',
    expectedSignal: 'nuxtPagesRouteParams'
  },
  {
    relPath: 'src/lib/Widget.svelte',
    ext: '.svelte',
    text: '<script>let count = 0; $: doubled = count * 2;</script>\n<style></style>',
    expectedId: 'svelte',
    expectedSignal: 'svelteReactiveBinding'
  },
  {
    relPath: 'src/routes/blog/[slug]/+page.svelte',
    ext: '.svelte',
    text: '<script>export let data;</script>',
    expectedId: 'sveltekit',
    expectedSignal: 'sveltekitRouteParam'
  },
  {
    relPath: 'src/app/users/user.component.ts',
    ext: '.ts',
    text: 'import { Input } from "@angular/core";\nexport class UserComponent {\n  @Input() id = "";\n}',
    expectedId: 'angular',
    expectedSignal: 'angularInputOutputBinding'
  },
  {
    relPath: 'src/pages/index.astro',
    ext: '.astro',
    text: '---\nconst title = "Home"\n---\n<div client:load>{title}</div>',
    expectedId: 'astro',
    expectedSignal: 'astroFrontmatterTemplateBridge'
  }
];

for (const testCase of CASES) {
  const profile = detectFrameworkProfile(testCase);
  assert.ok(profile, `expected framework profile for ${testCase.relPath}`);
  assert.equal(profile.id, testCase.expectedId, `framework id mismatch for ${testCase.relPath}`);
  assert.equal(profile.confidence, 'heuristic');
  if (testCase.expectedSignal) {
    assert.equal(profile.signals?.[testCase.expectedSignal], true, `missing expected signal ${testCase.expectedSignal}`);
  }
}

console.log('framework profile detection test passed');
