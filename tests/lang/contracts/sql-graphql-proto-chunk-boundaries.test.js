#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';

applyTestEnv();

const root = process.cwd();
const fixture = (...parts) => path.join(root, 'tests', 'fixtures', 'languages', 'src', ...parts);

const toKeySet = (chunks) => new Set(chunks.map((chunk) => `${chunk.name}|${chunk.kind}`));

const sqlText = await fs.readFile(fixture('sql_advanced.sql'), 'utf8');
const sqlChunks = smartChunk({ text: sqlText, ext: '.sql', mode: 'code' });
const sqlKeys = toKeySet(sqlChunks);
assert.ok(sqlKeys.has('widgets|TableDeclaration'), 'missing SQL table boundary');
assert.ok(sqlKeys.has('widget_names|ViewDeclaration'), 'missing SQL view boundary');
assert.ok(sqlKeys.has('widget_count|FunctionDeclaration'), 'missing SQL function boundary');
assert.ok(sqlKeys.has('idx_widgets_name|IndexDeclaration'), 'missing SQL index boundary');

const graphqlText = await fs.readFile(fixture('schema.graphql'), 'utf8');
const graphqlChunks = smartChunk({ text: graphqlText, ext: '.graphql', mode: 'code' });
const graphqlKeys = toKeySet(graphqlChunks);
assert.ok(graphqlKeys.has('schema|SchemaDeclaration'), 'missing GraphQL schema boundary');
assert.ok(graphqlKeys.has('type Query|TypeDeclaration'), 'missing GraphQL type boundary');
assert.ok(graphqlKeys.has('enum WidgetState|EnumDeclaration'), 'missing GraphQL enum boundary');

const protoText = await fs.readFile(fixture('schema.proto'), 'utf8');
const protoChunks = smartChunk({ text: protoText, ext: '.proto', mode: 'code' });
const protoKeys = toKeySet(protoChunks);
assert.ok(protoKeys.has('syntax|ConfigDeclaration'), 'missing Proto syntax boundary');
assert.ok(protoKeys.has('package widgets|NamespaceDeclaration'), 'missing Proto package boundary');
assert.ok(protoKeys.has('service WidgetService|ServiceDeclaration'), 'missing Proto service boundary');
assert.ok(protoKeys.has('rpc GetWidget|MethodDeclaration'), 'missing Proto rpc boundary');

console.log('SQL/GraphQL/Proto chunk boundaries test passed');
