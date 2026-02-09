#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'tree-sitter-scheduler-native-smoke', 'index-code');
const generatedFixtureDir = path.join(root, '.testCache', 'tree-sitter-scheduler-native-smoke', 'fixtures');
const markdownAbs = path.join(generatedFixtureDir, 'inline-markdown.md');

const fixtureRelPaths = [
  'tests/fixtures/tree-sitter/javascript.js',
  'tests/fixtures/baseline/src/index.ts',
  'tests/fixtures/sample/src/sample.py',
  'tests/fixtures/baseline/data/config.json',
  'tests/fixtures/formats/src/config.yaml',
  'tests/fixtures/formats/src/config.toml',
  'tests/fixtures/tree-sitter/kotlin.kt',
  'tests/fixtures/tree-sitter/csharp.cs',
  'tests/fixtures/tree-sitter/clike.c',
  'tests/fixtures/tree-sitter/cpp.cpp',
  'tests/fixtures/tree-sitter/objc.m',
  'tests/fixtures/tree-sitter/go.go',
  'tests/fixtures/tree-sitter/rust.rs',
  'tests/fixtures/tree-sitter/java.java',
  'tests/fixtures/formats/src/styles.css',
  'tests/fixtures/formats/src/unknown.html'
];

const expectedGrammarKeys = [
  'native:javascript',
  'native:typescript',
  'native:python',
  'native:json',
  'native:yaml',
  'native:toml',
  'native:markdown',
  'native:kotlin',
  'native:csharp',
  'native:clike',
  'native:cpp',
  'native:objc',
  'native:go',
  'native:rust',
  'native:java',
  'native:css',
  'native:html'
];

const entries = fixtureRelPaths.map((relPath) => path.join(root, ...relPath.split('/')));
for (const absPath of entries) {
  await fs.access(absPath);
}

await fs.rm(path.join(root, '.testCache', 'tree-sitter-scheduler-native-smoke'), { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(generatedFixtureDir, { recursive: true });
await fs.writeFile(
  markdownAbs,
  '# Markdown fixture\n\nInline: `const scheduler_markdown_chunk = 1234567890;`\n',
  'utf8'
);

const runtime = {
  root,
  segmentsConfig: { inlineCodeSpans: true },
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};

const scheduler = await runTreeSitterScheduler({
  mode: 'code',
  runtime,
  entries: [...entries, markdownAbs],
  outDir,
  abortSignal: null,
  log: () => {}
});

assert.ok(scheduler, 'expected scheduler lookup');
assert.ok(scheduler.plan, 'expected scheduler plan');
assert.ok(Array.isArray(scheduler.plan.grammarKeys), 'expected grammar keys in plan');
for (const grammarKey of expectedGrammarKeys) {
  assert.ok(
    scheduler.plan.grammarKeys.includes(grammarKey),
    `missing expected grammar key ${grammarKey}`
  );
}
assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');
assert.ok(
  scheduler.index.size >= expectedGrammarKeys.length,
  `expected at least ${expectedGrammarKeys.length} index rows, got ${scheduler.index.size}`
);

for (const virtualPath of scheduler.index.keys()) {
  const chunks = await scheduler.loadChunks(virtualPath);
  assert.ok(Array.isArray(chunks) && chunks.length > 0, `expected chunks for ${virtualPath}`);
}

console.log('tree-sitter scheduler native smoke ok');
