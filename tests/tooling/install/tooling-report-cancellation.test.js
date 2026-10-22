// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { detectRepoLanguages, buildToolingReport } from '../../../tools/tooling/utils.js';

const root = await makeTempDir('tooling-report-cancellation-');
const originalRead = fs.readdir;
try {
  await fs.mkdir(path.join(root, 'child'));
  await fs.writeFile(path.join(root, 'child', 'selected.py'), 'fixture source; never executed');
  const cancelled = new AbortController();
  const scanError = new Error('fixture language scan cancelled');
  let reads = 0;
  fs.readdir = async (...args) => {
    reads++;
    const result = await originalRead(...args);
    cancelled.abort(scanError);
    return result;
  };
  await assert.rejects(detectRepoLanguages(root, { signal: cancelled.signal }), error => error === scanError);
  assert.equal(reads, 1, 'the cancelled scan cannot enumerate the next child directory');
  fs.readdir = originalRead;
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: '',
    PAIROFCLEATS_TRUSTED_REPOS: '' }, async () => {
    const controller = new AbortController();
    const failure = new Error('fixture report cancelled during selected probe');
    let probes = 0;
    await assert.rejects(buildToolingReport(root, ['python', 'typescript'], { skipScan: true, signal: controller.signal,
      detectTool: async (_tool, options) => {
        probes++;
        assert.equal(options.signal, controller.signal, 'the report passes its actual cancellation owner to each probe');
        controller.abort(failure);
        return { found: true, path: 'inert fixture command', source: 'fixture' };
      }
    }), error => error === failure);
    assert.equal(probes, 1, 'no second selected command starts after cancellation');
  });
} finally { fs.readdir = originalRead; await rmDirRecursive(root); }
console.log('Tooling report cancellation stops repository discovery and later owned probes.');
