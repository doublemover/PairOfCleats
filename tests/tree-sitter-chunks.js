import fs from 'node:fs';
import path from 'node:path';
import { buildTreeSitterChunks } from '../src/lang/tree-sitter.js';

const root = path.resolve('tests', 'fixtures', 'tree-sitter');
const fixtures = [
  { id: 'swift', file: 'swift.swift', languageId: 'swift', expect: ['Widget', 'Widget.greet'] },
  { id: 'kotlin', file: 'kotlin.kt', languageId: 'kotlin', expect: ['Widget', 'Widget.greet'] },
  { id: 'csharp', file: 'csharp.cs', languageId: 'csharp', expect: ['Widget', 'Widget.Greet'] },
  { id: 'clike', file: 'clike.c', ext: '.c', expect: ['Widget', 'greet'] },
  { id: 'cpp', file: 'cpp.cpp', ext: '.cpp', expect: ['Widget', 'Widget.greet'] },
  { id: 'objc', file: 'objc.m', ext: '.m', expect: ['Widget', 'greet'] },
  { id: 'go', file: 'go.go', languageId: 'go', expect: ['Widget', 'Greet'] },
  { id: 'rust', file: 'rust.rs', languageId: 'rust', expect: ['Widget', 'Widget.greet'] },
  { id: 'java', file: 'java.java', languageId: 'java', expect: ['Widget', 'Widget.greet'] }
];

const options = { treeSitter: { enabled: true }, log: () => {} };

const first = fixtures[0];
const firstText = fs.readFileSync(path.join(root, first.file), 'utf8');
const firstChunks = buildTreeSitterChunks({
  text: firstText,
  languageId: first.languageId,
  ext: first.ext,
  options
});

if (!firstChunks || !firstChunks.length) {
  console.log('tree-sitter not available; skipping tree-sitter chunk tests.');
  process.exit(0);
}

const toNameSet = (chunks) => new Set(chunks.map((c) => c.name));
const assertHas = (set, expected, label) => {
  for (const name of expected) {
    if (!set.has(name)) {
      throw new Error(`${label} missing expected chunk name: ${name}`);
    }
  }
};

for (const fixture of fixtures) {
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
}

console.log('tree-sitter chunk fixtures passed.');
