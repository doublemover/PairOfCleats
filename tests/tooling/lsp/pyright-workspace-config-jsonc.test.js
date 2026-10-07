#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PYRIGHT_CONFIG_MAX_BYTES, resolvePyrightWorkspaceConfigPreflight } from '../../../src/index/tooling/preflight/pyright-workspace-config.js';
import { readJsonFileSafe } from '../../../src/shared/file-read.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-pyright-jsonc-'));
const config = path.join(root, 'pyrightconfig.json');
const resolve = () => resolvePyrightWorkspaceConfigPreflight({ ctx: { repoRoot: root } });
try {
  assert.equal((await resolve()).state, 'ready', 'absent optional config remains ready');
  for (const text of [
    '{ "include": ["src"] }',
    '// declared Pyright config\n{ "include": ["src",], /* retained comment */ "extraPaths": ["😀//literal",], }'
  ]) {
    await fs.writeFile(config, text);
    assert.equal((await resolve()).state, 'ready', 'the exact upstream-supported JSONC syntax is accepted');
  }
  assert.equal(await readJsonFileSafe(config, { fallback: 'strict-control' }), 'strict-control',
    'ordinary JSON readers retain their strict parsing policy');
  for (const text of ['', '{ "include": ', '[]', '42']) {
    await fs.writeFile(config, text);
    const result = await resolve();
    assert.equal(result.state, 'degraded');
    assert.equal(result.reasonCode, 'pyright_workspace_config_invalid');
  }
  await fs.writeFile(config, ' '.repeat(PYRIGHT_CONFIG_MAX_BYTES + 1));
  assert.equal((await resolve()).reasonCode, 'pyright_workspace_config_too_large');
  await fs.rm(config);
  await fs.mkdir(config);
  assert.equal((await resolve()).reasonCode, 'pyright_workspace_config_unreadable');
  await fs.rm(config, { recursive: true });
  const outside = path.join(root, '..', `${path.basename(root)}-outside.json`);
  await fs.writeFile(outside, '{}');
  try {
    let linked = false;
    try {
      await fs.symlink(outside, config);
      linked = true;
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
      console.log('Optional symlink control unavailable under this Windows permission profile.');
    }
    if (linked) {
      assert.equal((await resolve()).reasonCode, 'pyright_workspace_config_unreadable',
        'format support does not widen the contained read boundary');
    }
  } finally {
    await fs.rm(config, { force: true });
    await fs.rm(outside, { force: true });
  }
  console.log('Pyright JSONC comments/trailing commas pass; malformed, oversized and unavailable config remain explicit; generic JSON stays strict.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
