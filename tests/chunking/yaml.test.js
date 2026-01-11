#!/usr/bin/env node
import { chunkYaml } from '../../src/index/chunking.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const yamlText = [
  'defaults: &defaults',
  '  name: base',
  'service:',
  '  <<: *defaults',
  '  port: 80'
].join('\n');

const topLevel = chunkYaml(yamlText, 'config.yml', {
  yamlChunking: { mode: 'top-level', maxBytes: 1024 }
}) || [];

const names = new Set(topLevel.map((chunk) => chunk.name));
expect(names.has('defaults'), 'Missing top-level chunk for defaults.');
expect(names.has('service'), 'Missing top-level chunk for service.');

const rootOnly = chunkYaml(yamlText, 'config.yml', { yamlChunking: { mode: 'root' } }) || [];
expect(rootOnly.length === 1, `Expected root mode to return 1 chunk, got ${rootOnly.length}`);
expect(rootOnly[0].name === 'root', 'Expected root chunk name.');

const multiDoc = [
  '---',
  'first: 1',
  '---',
  'second: 2'
].join('\n');
const multiChunks = chunkYaml(multiDoc, 'config.yml', { yamlChunking: { mode: 'top-level' } }) || [];
const multiNames = new Set(multiChunks.map((chunk) => chunk.name));
expect(multiNames.has('first'), 'Missing first doc chunk.');
expect(multiNames.has('second'), 'Missing second doc chunk.');

console.log('Chunking YAML test passed.');
