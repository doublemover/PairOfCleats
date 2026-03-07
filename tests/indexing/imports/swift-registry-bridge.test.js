#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectLanguageImports } from '../../../src/index/language-registry.js';

const text = [
  'import Foundation',
  '@testable import Kingfisher',
  '',
  'struct Example {',
  '  let value: String',
  '}'
].join('\n');

const imports = collectLanguageImports({
  ext: '.swift',
  relPath: 'Sources/Example.swift',
  text,
  mode: 'code'
});

assert.deepEqual(imports.sort(), ['Foundation', 'Kingfisher'].sort(), 'expected Swift imports to bridge through registry');

console.log('imports swift registry bridge test passed');
