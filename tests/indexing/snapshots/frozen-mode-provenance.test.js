#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256File } from '../../../src/shared/hash.js';
import { readFrozenModeState } from '../../../src/index/snapshots/mode-provenance.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-frozen-modes-'));
try {
  await fs.mkdir(path.join(root, 'provenance'));
  const receipts = {};
  for (const [mode, id] of [['code', 'B'], ['prose', 'A']]) {
    const state = { buildId: id, configHash: `config-${id}`, tool: { version: id } };
    await fs.mkdir(path.join(root, `index-${mode}`, 'pieces'), { recursive: true });
    await fs.writeFile(path.join(root, `index-${mode}`, 'pieces', 'manifest.json'), JSON.stringify({ mode, buildId: id, compatibilityKey: id }));
    const statePath = `provenance/${mode}.build_state.json`;
    await fs.writeFile(path.join(root, statePath), JSON.stringify(state));
    receipts[mode] = { mode, statePath, sha256: await sha256File(path.join(root, statePath)), buildId: id,
      configHash: state.configHash, toolVersion: id, compatibilityKey: id };
    assert.equal(readFrozenModeState({ frozenRoot: root, mode, receipt: receipts[mode] }).buildId, id);
  }
  assert.throws(() => readFrozenModeState({ frozenRoot: root, mode: 'prose', receipt: receipts.code }));
  await fs.writeFile(path.join(root, receipts.prose.statePath), '{}');
  assert.throws(() => readFrozenModeState({ frozenRoot: root, mode: 'prose', receipt: receipts.prose }), /checksum/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
