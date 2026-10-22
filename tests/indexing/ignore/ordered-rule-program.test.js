#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ignore-order-'));
const config = { useDefaultSkips: false, useGitignore: false, usePairofcleatsIgnore: false };
try {
  const matcher = async patterns => (await buildIgnoreMatcher({ root, userConfig: { ...config, extraIgnore: patterns } })).ignoreMatcher;
  assert.equal((await matcher(['*.js', '!keep.js', '*.js'])).ignores('keep.js'), true);
  const selected = await matcher(['private/', '!private/a.js', '!private/b.js']);
  assert.equal(selected.ignores('private/a.js'), false);
  assert.equal(selected.ignores('private/b.js'), false);
  assert.equal(selected.ignores('private/secret.js'), true);
  const spaced = await matcher([' leading.js', 'trailing\\ ', '\\#literal', '\\!literal']);
  assert.equal(spaced.ignores(' leading.js'), true);
  assert.equal(spaced.ignores('leading.js'), false);
  assert.equal(spaced.ignores('trailing '), true);
  assert.equal(spaced.ignores('#literal'), true);
  assert.equal(spaced.ignores('!literal'), true);
} finally { await fs.rm(root, { recursive: true, force: true }); }
