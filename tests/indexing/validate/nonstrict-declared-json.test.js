import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('nonstrict-declared-json');
try {
  const fixture = await createBaseIndex({ rootDir: dir });
  const filename = path.join(fixture.indexDir, '.filelists.json'), original = await fs.readFile(filename);
  const run = () => validateIndexArtifacts({ root: fixture.repoRoot, indexRoot: fixture.indexRoot,
    modes: ['code'], userConfig: defaultUserConfig, strict: false, sqliteEnabled: false, lmdbEnabled: false });
  assert.equal((await run()).ok, true, 'valid listed JSON and absent optional families remain admitted');
  await fs.writeFile(filename, '{malformed-listed-json');
  const malformed = await run();
  assert.equal(malformed.ok, false); assert.equal(malformed.modes.code.ok, false);
  assert.ok(malformed.findings.some(row => row.artifact === 'filelists' && row.severity === 'error'));
  await fs.writeFile(filename, original);
  const manifestPath = path.join(fixture.indexDir, 'pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const piece of [{ name: 'field_tokens', path: 'absent.jsonl', format: 'jsonl' },
    { name: 'field_tokens', path: '../escape.json', format: 'json' }]) {
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, pieces: [...manifest.pieces, piece] }));
    const report = await run(); assert.equal(report.ok, false); assert.equal(report.modes.code.ok, false);
    assert.ok(report.issues.some(value => /field_tokens|manifest/u.test(value)));
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  assert.equal((await run()).ok, true);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Non-strict validation reads declared malformed JSON and preserves declaration/path/shard failures with absent optional leniency.');
