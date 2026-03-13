#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { buildTypeScriptChunks } from '../../../src/lang/typescript.js';

applyTestEnv();

const root = process.cwd();
const fixturePath = path.join(root, 'tests', 'fixtures', 'languages', 'src', 'typescript_advanced.ts');
const text = await fs.readFile(fixturePath, 'utf8');
const chunks = buildTypeScriptChunks(text, { ext: '.ts' });

const chunkKeySet = new Set(chunks.map((chunk) => `${chunk.name}|${chunk.kind}`));

const expected = [
  'Renderer|InterfaceDeclaration',
  'WidgetOptions|TypeAliasDeclaration',
  'BaseWidget|ClassDeclaration',
  'BaseWidget.constructor|ConstructorDeclaration',
  'Widget|ClassDeclaration',
  'Widget.render|MethodDeclaration',
  'Widget.from|MethodDeclaration',
  'makeWidget|FunctionDeclaration',
  'buildWidgetAliases|FunctionDeclaration'
];

for (const key of expected) {
  assert.ok(chunkKeySet.has(key), `missing TypeScript chunk boundary: ${key}`);
}

console.log('typescript chunk boundaries test passed');
