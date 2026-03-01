#!/usr/bin/env node
import { smartChunk } from '../../../src/index/chunking.js';

const text = "alpha: 1\nbeta: 2\n";
const defaultChunks = smartChunk({
  text,
  ext: '.yaml',
  relPath: 'config.yaml',
  mode: 'code'
});
if (defaultChunks.length !== 1 || defaultChunks[0].name !== 'root') {
  console.error('Expected default YAML chunking to return a root chunk.');
  process.exit(1);
}

const top = smartChunk({
  text,
  ext: '.yaml',
  relPath: 'config.yaml',
  mode: 'code',
  context: { yamlChunking: { mode: 'top-level' } }
});
const topNames = top.map((chunk) => chunk.name);
if (top.length !== 2 || !topNames.includes('alpha') || !topNames.includes('beta')) {
  console.error(`Unexpected top-level YAML chunks: ${topNames.join(',')}`);
  process.exit(1);
}

const rootOnly = smartChunk({
  text,
  ext: '.yaml',
  relPath: 'config.yaml',
  mode: 'code',
  context: { yamlChunking: { mode: 'root' } }
});
if (rootOnly.length !== 1 || rootOnly[0].name !== 'root') {
  console.error('Expected root-only YAML chunking.');
  process.exit(1);
}

const autoLarge = smartChunk({
  text,
  ext: '.yaml',
  relPath: 'config.yaml',
  mode: 'code',
  context: { yamlChunking: { mode: 'auto', maxBytes: 4 } }
});
if (autoLarge.length !== 1 || autoLarge[0].name !== 'root') {
  console.error('Expected auto YAML chunking to fall back to root.');
  process.exit(1);
}

const tabIndented = smartChunk({
  text: 'root:\n\tchild: 1\nother: 2\n',
  ext: '.yaml',
  relPath: 'config.yaml',
  mode: 'code',
  context: { yamlChunking: { mode: 'top-level' } }
});
const tabNames = tabIndented.map((chunk) => chunk.name);
if (!tabNames.includes('root') || !tabNames.includes('other') || tabNames.includes('child')) {
  console.error(`Unexpected tab-indented YAML chunks: ${tabNames.join(',')}`);
  process.exit(1);
}

const workflowText = [
  'name: CI',
  'on: [push]',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '  test:',
  '    runs-on: ubuntu-latest'
].join('\n');
const workflowChunks = smartChunk({
  text: workflowText,
  ext: '.yaml',
  relPath: '.github\\workflows\\ci.yml',
  mode: 'code',
  context: { yamlChunking: { mode: 'top-level' } }
});
const workflowNames = workflowChunks.map((chunk) => chunk.name);
if (!workflowNames.includes('build') || !workflowNames.includes('test')) {
  console.error(`Expected workflow chunking to produce job sections, got: ${workflowNames.join(',')}`);
  process.exit(1);
}

console.log('yaml chunking test passed');
