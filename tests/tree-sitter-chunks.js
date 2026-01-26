import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTreeSitterChunks,
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser,
  shutdownTreeSitterWorkerPool
} from '../src/lang/tree-sitter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tree-sitter');
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

const resolvePreloadId = (fixture) => (
  fixture.languageId
  || (fixture.ext === '.c' ? 'clike' : null)
  || (fixture.ext === '.cpp' ? 'cpp' : null)
  || (fixture.ext === '.m' ? 'objc' : null)
);

const cleanup = async () => {
  resetTreeSitterParser({ hard: true });
  pruneTreeSitterLanguages([]);
  await shutdownTreeSitterWorkerPool();
};

const run = async () => {
  const options = { treeSitter: { enabled: true, maxLoadedLanguages: 2 }, log: () => {} };

  const first = fixtures[0];
  await preloadTreeSitterLanguages([resolvePreloadId(first)], {
    maxLoadedLanguages: options.treeSitter.maxLoadedLanguages
  });
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

  for (const fixture of fixtures) {
    await preloadTreeSitterLanguages([resolvePreloadId(fixture)], {
      maxLoadedLanguages: options.treeSitter.maxLoadedLanguages
    });
    const text = fs.readFileSync(path.join(root, fixture.file), 'utf8');
    const chunks = buildTreeSitterChunks({
      text,
      languageId: fixture.languageId,
      ext: fixture.ext,
      options
    }) || [];
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
  await cleanup();
}
