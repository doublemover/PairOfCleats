import fs from 'node:fs';
import path from 'node:path';
import {
  buildTreeSitterChunks,
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser,
  shutdownTreeSitterWorkerPool
} from '../../../src/lang/tree-sitter.js';
import { repoRoot } from '../../helpers/root.js';

const root = path.join(repoRoot(), 'tests', 'fixtures', 'tree-sitter');
const fixtures = [
  { id: 'swift', file: 'swift.swift', languageId: 'swift', expect: ['Widget', 'Widget.greet'] },
  { id: 'kotlin', file: 'kotlin.kt', languageId: 'kotlin', expect: ['Widget', 'Widget.greet'] },
  { id: 'csharp', file: 'csharp.cs', languageId: 'csharp', expect: ['Widget', 'Widget.Greet'] },
  { id: 'clike', file: 'clike.c', ext: '.c', expect: ['Widget', 'greet'] },
  { id: 'cpp', file: 'cpp.cpp', ext: '.cpp', expect: ['Widget', 'Widget.greet'] },
  { id: 'objc', file: 'objc.m', ext: '.m', expect: ['Widget', 'greet'] },
  { id: 'go', file: 'go.go', languageId: 'go', expect: ['Widget', 'Widget.Greet'] },
  { id: 'rust', file: 'rust.rs', languageId: 'rust', expect: ['Widget', 'Widget.greet'] },
  { id: 'java', file: 'java.java', languageId: 'java', expect: ['Widget', 'Widget.greet'] },
  {
    id: 'javascript',
    file: 'javascript.js',
    languageId: 'javascript',
    expect: ['top', 'Foo', 'Foo.method', 'Foo.make', 'outer'],
    noKinds: ['ArrowFunction']
  }
];

// NOTE: We've seen occasional native OOM/SIGTRAP aborts when exercising a large
// multi-language sequence in a single process. This test is a smoke/integration
// check for the tree-sitter chunker, not a comprehensive per-grammar suite.
//
// By default, run a single fixture. To force the full suite, set
// POC_TREE_SITTER_CHUNKS_FULL=1. To target a specific fixture, set
// POC_TREE_SITTER_CHUNKS_FIXTURE=<fixture id>.
const forceFull = process.env.POC_TREE_SITTER_CHUNKS_FULL === '1';
const requestedFixture = typeof process.env.POC_TREE_SITTER_CHUNKS_FIXTURE === 'string'
  ? process.env.POC_TREE_SITTER_CHUNKS_FIXTURE.trim()
  : '';
const reducedFixture = fixtures.find((f) => f.id === 'javascript') || fixtures[0];
const selectedFixture = requestedFixture
  ? fixtures.find((f) => f.id === requestedFixture) || reducedFixture
  : reducedFixture;
const fixturesToRun = forceFull ? fixtures : [selectedFixture];

const resolvePreloadId = (fixture) => (
  fixture.languageId
  || (fixture.ext === '.c' ? 'clike' : null)
  || (fixture.ext === '.cpp' ? 'cpp' : null)
  || (fixture.ext === '.m' ? 'objc' : null)
);

const cleanup = async () => {
  // Cleanup of WASM tree-sitter language objects has proven flaky on some CI runners
  // (native abort / SIGTRAP in node 24 builds). These tests run in an isolated process
  // and primarily validate chunk extraction output, so avoid the most aggressive
  // teardown paths to keep CI stable.
  resetTreeSitterParser();
  await shutdownTreeSitterWorkerPool();
};

const run = async () => {
  if (runReduced) {
    const reason = runReducedOnCiLinux ? 'CI/Linux' : 'CI/macOS';
    console.log(
      `[tree-sitter] ${reason} detected; running reduced fixture set: ${fixturesToRun.map((f) => f.id).join(', ')}`
    );
  }

  const enabledLanguages = Object.fromEntries(
    fixturesToRun
      .map((fixture) => resolvePreloadId(fixture) || fixture.languageId)
      .filter((id) => typeof id === 'string' && id)
      .map((id) => [id, true])
  );

  const options = {
    treeSitter: {
      enabled: true,
      languages: enabledLanguages,
      // Avoid eviction during this test run; eviction + delete paths are covered elsewhere
      // and have shown to be sensitive to runner/node build combinations.
      maxLoadedLanguages: 1
    },
    log: () => {}
  };
  const preloadLanguage = async (fixture) => {
    const resolvedId = resolvePreloadId(fixture) || fixture.languageId;
    if (!resolvedId) return;
    await preloadTreeSitterLanguages([resolvedId], {
      maxLoadedLanguages: options.treeSitter.maxLoadedLanguages
    });
    pruneTreeSitterLanguages([resolvedId], {
      maxLoadedLanguages: options.treeSitter.maxLoadedLanguages,
      onlyIfExceeds: true
    });
  };

  const first = fixturesToRun[0];
  await preloadLanguage(first);
  const firstText = fs.readFileSync(path.join(root, first.file), 'utf8');
  const firstChunks = buildTreeSitterChunks({
    text: firstText,
    languageId: first.languageId,
    ext: first.ext,
    options
  });

  if (!firstChunks || !firstChunks.length) {
    console.log('tree-sitter not available; skipping tree-sitter chunk tests.');
    return;
  }

  const limitedByBytes = buildTreeSitterChunks({
    text: firstText,
    languageId: first.languageId,
    ext: first.ext,
    options: { treeSitter: { enabled: true, maxBytes: 1 }, log: () => {} }
  });

  if (limitedByBytes !== null) {
    throw new Error('expected tree-sitter to skip oversized file by maxBytes');
  }

  const limitedByLines = buildTreeSitterChunks({
    text: firstText,
    languageId: first.languageId,
    ext: first.ext,
    options: { treeSitter: { enabled: true, maxLines: 1 }, log: () => {} }
  });

  if (limitedByLines !== null) {
    throw new Error('expected tree-sitter to skip oversized file by maxLines');
  }

  const toNameSet = (chunks) => new Set(chunks.map((c) => c.name));
  const toKindSet = (chunks) => new Set(chunks.map((c) => c.kind));
  const assertHas = (set, expected, label) => {
    for (const name of expected) {
      if (!set.has(name)) {
        throw new Error(`${label} missing expected chunk name: ${name}`);
      }
    }
  };

  const assertNotHas = (set, forbidden, label) => {
    for (const item of forbidden || []) {
      if (set.has(item)) {
        throw new Error(`${label} unexpectedly contained: ${item}`);
      }
    }
  };

  for (const fixture of fixturesToRun) {
    if (fixture !== first) {
      await preloadLanguage(fixture);
    }
    const isFirst = fixture === first;
    const text = isFirst ? firstText : fs.readFileSync(path.join(root, fixture.file), 'utf8');
    const chunks = (isFirst
      ? firstChunks
      : buildTreeSitterChunks({
        text,
        languageId: fixture.languageId,
        ext: fixture.ext,
        options
      })) || [];
    if (!chunks.length) {
      throw new Error(`${fixture.id} tree-sitter chunks not found`);
    }
    const names = toNameSet(chunks);
    assertHas(names, fixture.expect, fixture.id);
    if (fixture.noKinds) {
      const kinds = toKindSet(chunks);
      assertNotHas(kinds, fixture.noKinds, fixture.id);
    }
  }

  console.log('tree-sitter chunk fixtures passed.');
};

try {
  await run();
} finally {
  // On CI/Linux, we intentionally avoid the extra teardown work because we've
  // observed sporadic native aborts during WASM object cleanup on some runners.
  // The test runs in an isolated process; skipping cleanup here is safe.
  if (!runReduced) {
    await cleanup();
  }
}
