#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const runtimePath = path.join(root, 'src', 'index', 'build', 'runtime', 'runtime.js');
const source = await fs.readFile(runtimePath, 'utf8');

assert.match(
  source,
  /const embeddingWarmModelPath = embeddingProvider === 'onnx'[\s\S]*resolvedModelPath \|\| embeddingOnnx\?\.modelPath/m,
  'expected daemon warm-key identity to include resolved/explicit ONNX model path'
);
assert.match(
  source,
  /const embeddingWarmKey = \[[\s\S]*embeddingWarmModelPath[\s\S]*\]\.join\(':'.*\);/m,
  'expected embedding warm key to include model-path identity component'
);

console.log('runtime embedding warm-key model path test passed');
