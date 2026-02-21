#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { chunkXml } from '../../../src/index/chunking.js';

applyTestEnv();

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const xmlText = [
  '<root xmlns:cfg="urn:cfg">',
  '  <cfg:service id="a" />',
  '  <cfg:worker id="b" />',
  '</root>'
].join('\n');

const chunks = chunkXml(xmlText, {}) || [];
const names = new Set(chunks.map((chunk) => chunk.name));
expect(names.has('cfg:service'), 'Missing namespaced XML chunk for cfg:service.');
expect(names.has('cfg:worker'), 'Missing namespaced XML chunk for cfg:worker.');

const first = chunkXml(xmlText, {}) || [];
const second = chunkXml(xmlText, {}) || [];
expect(JSON.stringify(first) === JSON.stringify(second), 'Expected deterministic XML chunk ordering across runs.');

console.log('Chunking XML test passed.');
