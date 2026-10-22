import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const env = applyTestEnv({ syncProcess: false });
const { dir } = await prepareIsolatedTestCacheDir('piece-assembly-output-authority');
try {
  for (const kind of ['same', 'ancestor', 'descendant', 'missing-input', ...(process.platform === 'win32' ? ['case-alias'] : [])]) {
    const fixture = path.join(dir, kind);
    const input = path.join(fixture, 'input');
    await fs.mkdir(input, { recursive: true });
    const marker = path.join(input, 'source-marker');
    await fs.writeFile(marker, 'source pieces must survive');
    const out = kind === 'ancestor' ? fixture : kind === 'descendant'
      ? path.join(input, 'nested-output') : kind === 'missing-input' ? path.join(fixture, 'existing-output')
        : kind === 'case-alias' ? input.toUpperCase() : input;
    const outMarker = path.join(out, 'output-marker');
    if (kind === 'missing-input') {
      await fs.mkdir(out);
      await fs.writeFile(outMarker, 'existing output must survive invalid input');
    }
    const result = spawnSync(process.execPath, ['tools/index/assemble-pieces.js', '--repo', process.cwd(),
      '--input', kind === 'missing-input' ? path.join(fixture, 'absent') : input,
      '--out', out, '--force'], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(await fs.readFile(marker, 'utf8'), 'source pieces must survive');
    if (kind === 'missing-input') {
      assert.equal(await fs.readFile(outMarker, 'utf8'), 'existing output must survive invalid input');
    } else assert.match(result.stderr, /overlap/i);
    if (kind === 'descendant') await assert.rejects(fs.stat(out), { code: 'ENOENT' });
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('piece assembly refuses overlapping or invalid inputs before forced output mutation');
