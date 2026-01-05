#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTypeScriptChunks } from '../src/lang/typescript.js';

const sample = 'export function foo(a: number): string { return String(a); }';

const heuristicChunks = buildTypeScriptChunks(sample, { parser: 'heuristic' });
assert.ok(Array.isArray(heuristicChunks) && heuristicChunks.length > 0);

const babelChunks = buildTypeScriptChunks(sample, { parser: 'babel' });
assert.ok(Array.isArray(babelChunks) && babelChunks.length > 0);

const tsChunks = buildTypeScriptChunks(sample, { parser: 'typescript', rootDir: process.cwd() });
assert.ok(Array.isArray(tsChunks) && tsChunks.length > 0);

console.log('typescript parser selection test passed');
