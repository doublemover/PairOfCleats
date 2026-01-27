#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTypeScriptRelations } from '../../src/lang/typescript.js';

const source = `
const View = () => <div>{bar()}</div>;
`;

const relations = buildTypeScriptRelations(source, null, { ext: '.tsx' });
const details = Array.isArray(relations?.callDetails) ? relations.callDetails : [];
assert.ok(details.length >= 1, 'expected TSX call details');
assert.ok(details.some((detail) => detail.calleeNormalized === 'bar'), 'expected bar() call detail');

console.log('tsx call details v2 test passed');
