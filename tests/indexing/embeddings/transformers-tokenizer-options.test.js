#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(process.argv[2] ? path.resolve(process.argv[2]) : import.meta.url);
const entry = require.resolve('@huggingface/transformers');
const suite = path.join(process.cwd(), 'temp', 'tasks', 'tokenizer-options');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
const cache = path.join(root, 'explicit-cache');
const revision = '0123456789abcdef0123456789abcdef01234567';
const modelId = 'qualified/offline-tokenizer';
const leaf = path.join(cache, modelId, revision);
await fs.mkdir(leaf, { recursive: true });
await fs.writeFile(path.join(leaf, 'tokenizer.json'), JSON.stringify({
  version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null,
  pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null,
  model: { type: 'WordLevel', vocab: { '[UNK]': 0, hello: 1 }, unk_token: '[UNK]' }
}));
await fs.writeFile(path.join(leaf, 'tokenizer_config.json'), JSON.stringify({
  tokenizer_class: 'PreTrainedTokenizer', unk_token: '[UNK]'
}));
for (const [name, mod] of [
  ['node-esm', await import(pathToFileURL(path.join(path.dirname(entry), 'transformers.node.mjs')))],
  ['node-cjs', require('@huggingface/transformers')]
]) {
  const previous = { allowRemoteModels: mod.env.allowRemoteModels,
    localModelPath: mod.env.localModelPath, cacheDir: mod.env.cacheDir };
  try {
    mod.env.allowRemoteModels = false;
    mod.env.localModelPath = path.join(root, 'empty-local');
    mod.env.cacheDir = path.join(root, 'empty-default-cache');
    const tokenizer = await mod.AutoTokenizer.from_pretrained(modelId, {
      revision, cache_dir: cache, local_files_only: true
    });
    assert.deepEqual(tokenizer('hello', { return_tensor: false }).input_ids, [1], name);
    await assert.rejects(mod.AutoTokenizer.from_pretrained(modelId, {
      revision: 'missing', cache_dir: cache, local_files_only: true
    }), /tokenizer_class|not found locally/);
    await assert.rejects(mod.AutoTokenizer.from_pretrained(modelId, {
      revision, local_files_only: true
    }), /tokenizer_class|not found locally/);
  } finally {
    Object.assign(mod.env, previous);
  }
}
console.log('Pinned offline tokenizer options test passed for Node ESM and CJS');
