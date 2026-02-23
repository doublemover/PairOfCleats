#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-scm-none');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {},
  scmConfig: { provider: 'none', annotate: { enabled: true } },
  strict: false
}, null, { log: () => {} });

assert.equal(report?.scm?.provider, 'none', 'expected provider none');
assert.equal(report?.scm?.annotateEnabled, false, 'annotate should be disabled when provider none');

console.log('tooling doctor scm none test passed');
