#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildCLikeChunks, buildCLikeRelations } from '../../../src/lang/clike.js';

applyTestEnv();

const headerText = [
  '#import <Foundation/Foundation.h>',
  '',
  '@interface Widget : NSObject',
  '- (void)greet:(NSString *)name;',
  '@end',
  '',
  '@implementation Widget',
  '- (void)greet:(NSString *)name {',
  '  if (name) { NSLog(@"%@", name); }',
  '}',
  '@end'
].join('\n');

const chunks = buildCLikeChunks(headerText, '.h', { treeSitter: { enabled: false }, log: () => {} }) || [];
assert.ok(
  chunks.some((chunk) => chunk.kind === 'InterfaceDeclaration' && chunk.name === 'Widget'),
  'expected ObjC interface declaration in header routing'
);
assert.ok(
  chunks.some((chunk) => chunk.kind === 'MethodDeclaration' && String(chunk.name || '').includes('greet:')),
  'expected ObjC method declaration in header routing'
);

const relations = buildCLikeRelations(headerText, 'src/Widget.h', {});
assert.ok(
  Array.isArray(relations.imports) && relations.imports.includes('Foundation/Foundation.h'),
  'expected #import directives to be included in C-like imports'
);

const callNames = new Set((relations.calls || []).map((entry) => (Array.isArray(entry) ? entry[1] : entry?.callee)));
assert.ok(!callNames.has('if'), 'expected ObjC keyword skip set to exclude if from calls');

console.log('clike objc header routing test passed');
