#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { getCacheRoot } from '../../src/shared/cache-roots.js';
import {
  TUI_INSTALL_LAYOUT_DIR,
  resolveTuiInstallLayout
} from '../../tools/tui/targets.js';

ensureTestingEnv(process.env);

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
const tempCacheRoot = path.join(os.tmpdir(), `poc-tui-cache-${process.pid}`);
process.env.PAIROFCLEATS_CACHE_ROOT = tempCacheRoot;

try {
  const layout = resolveTuiInstallLayout({
    root: process.cwd(),
    triple: 'x86_64-pc-windows-msvc',
    artifactName: 'pairofcleats-tui.exe'
  });
  const expectedInstallRoot = path.join(getCacheRoot(), 'tui', TUI_INSTALL_LAYOUT_DIR);
  assert.equal(layout.baseInstallRoot, expectedInstallRoot);
  assert.equal(
    layout.baseInstallRoot.includes(`${path.sep}.cache${path.sep}`),
    false,
    'default TUI install root should not fall back to repo-local .cache'
  );
} finally {
  if (typeof previousCacheRoot === 'string') {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  } else {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  }
}

console.log('tui install layout default root test passed');
