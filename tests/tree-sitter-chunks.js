import fs from 'node:fs';
import path from 'node:path';
import { buildTreeSitterChunks, preloadTreeSitterLanguages } from '../src/lang/tree-sitter.js';
import { isTreeSitterEnabled } from '../src/lang/tree-sitter/options.js';

const root = path.resolve('tests', 'fixtures', 'tree-sitter');
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

const resolveLanguageId = (fixture) => fixture.languageId
  || (fixture.ext === '.c' ? 'clike' : null)
  || (fixture.ext === '.cpp' ? 'cpp' : null)
  || (fixture.ext === '.m' ? 'objc' : null);

const preloadIds = fixtures
  .map((fixture) => resolveLanguageId(fixture))
  .filter(Boolean);

await preloadTreeSitterLanguages(preloadIds);

const options = { treeSitter: { enabled: true }, log: () => {} };

let probeFixture = null;
let probeText = '';
let probeChunks = null;
for (const fixture of fixtures) {
  const text = fs.readFileSync(path.join(root, fixture.file), 'utf8');
  const chunks = buildTreeSitterChunks({
    text,
    languageId: fixture.languageId,
    ext: fixture.ext,
    options
  });
  if (chunks && chunks.length) {
    probeFixture = fixture;
    probeText = text;
    probeChunks = chunks;
    break;
  }
}

if (!probeChunks || !probeChunks.length) {
  console.log('tree-sitter not available; skipping tree-sitter chunk tests.');
  process.exit(0);
}

const limitedByBytes = buildTreeSitterChunks({
  text: probeText,
  languageId: probeFixture.languageId,
  ext: probeFixture.ext,
  options: { treeSitter: { enabled: true, maxBytes: 1 }, log: () => {} }
});

if (limitedByBytes !== null) {
  throw new Error('expected tree-sitter to skip oversized file by maxBytes');
}

const limitedByLines = buildTreeSitterChunks({
  text: probeText,
  languageId: probeFixture.languageId,
  ext: probeFixture.ext,
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
  const text = fs.readFileSync(path.join(root, fixture.file), 'utf8');
  const resolvedId = resolveLanguageId(fixture);
  const chunks = buildTreeSitterChunks({
    text,
    languageId: fixture.languageId,
    ext: fixture.ext,
    options
  }) || [];
  if (!chunks.length) {
    if (resolvedId && !isTreeSitterEnabled(options, resolvedId)) {
      continue;
    }
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
