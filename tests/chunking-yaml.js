#!/usr/bin/env node
import { smartChunk } from '../src/indexer/chunking.js';

const text = "alpha: 1\nbeta: 2\n";

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

console.log('yaml chunking test passed');
