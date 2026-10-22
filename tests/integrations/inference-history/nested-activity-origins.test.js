import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extractFileEvidence } from '../../../src/integrations/inference-history/file-evidence.js';
import { prepareFileEvidenceArtifacts } from '../../../src/integrations/inference-history/artifact-preparation.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { normalizeHistoryRecord } from '../../../src/integrations/inference-history/records.js';
import { DEFAULT_LIMITS } from '../../../src/integrations/inference-history/common.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'activity-origin-')));
try {
  const sourceRoot = path.join(root, 'sources'); await fs.mkdir(sourceRoot);
  const message = text => ({ message: { author: { role: 'user' }, content: { parts: [text] } } });
  await fs.writeFile(path.join(sourceRoot, 'report.json'), JSON.stringify({
    'a/~': { activity_messages: [message('first blue fact')] },
    b: [{ activity_messages: [message('other blue fact')] }],
    c: { activity_messages: [message('first blue fact')] }
  }));
  const extraction = await extractFileEvidence({ sourceRoot, outputRoot: path.join(root, 'catalog'), authorizePaths: () => true });
  const db = new Database(extraction.catalogPath);
  db.prepare("UPDATE documents SET status='facts_limited' WHERE format='json'").run(); db.close();
  const prepare = outputRoot => prepareFileEvidenceArtifacts({ catalogPaths: [extraction.catalogPath], outputRoot, authorizePaths: () => true });
  const read = async outputRoot => {
    const summary = await prepare(outputRoot);
    return (await Promise.all(summary.shards.map(shard => fs.readFile(path.join(outputRoot, shard.name), 'utf8').then(JSON.parse)))).flat()
      .filter(row => row.artifact_kind === 'activity');
  };
  const rows = await read(path.join(root, 'first'));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.ok(rows.some(row => row.provenance.locator.includes('/a~1~0/activity_messages/0')));
  assert.ok(rows.some(row => row.provenance.locator.includes('/b/0/activity_messages/0')));
  assert.deepEqual((await read(path.join(root, 'second'))).map(row => row.id), rows.map(row => row.id));
  for (const row of rows) normalizeHistoryRecord(row, 'recovered_artifact', DEFAULT_LIMITS);
  const base = { text: 'identical', sourceSha256: 'a'.repeat(64), locator: 'x'.repeat(1500) };
  const left = projectArtifact({ ...base, locator: `${base.locator}/left` })[0];
  const right = projectArtifact({ ...base, locator: `${base.locator}/right` })[0];
  assert.equal(left.title, right.title);
  assert.notEqual(left.id, right.id);
  assert.notEqual(left.provenance.origin_hash, right.provenance.origin_hash);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Nested activities retain deterministic full origins through bounded display locators.');
