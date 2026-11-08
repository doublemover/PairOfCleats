import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { renderRecordMarkdown } from '../../../src/integrations/triage/render.js';
import { promoteRecordFields } from '../../../src/integrations/triage/record-utils.js';
import { readTriagePublication } from '../../../src/integrations/triage/record-publication.js';
import { writeTriageRecordArtifacts } from '../../../tools/triage/record-writer.js';
import { TRIAGE_PUBLICATION_FIELD, TRIAGE_RENDERER_VERSION } from '../../../src/contracts/triage-record-publication.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('triage-renderer-package-authority');
const record = { recordType: 'finding', recordId: 'empty', source: 'generic',
  vuln: { vulnId: 'CVE-EMPTY', title: 'Empty' }, packages: [], package: { name: 'stale', installedVersion: '9' } };
const frozenLegacyText = '# Finding CVE-EMPTY (stale@9)\n\n## Summary\n- Record ID: empty\n- Title: Empty\n\n## Environment\n';
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  assert.equal(TRIAGE_RENDERER_VERSION, 3);
  assert.deepEqual(promoteRecordFields(record, ['packageName', 'packageEcosystem']), {});
  assert.equal(renderRecordMarkdown(record), frozenLegacyText.replace(' (stale@9)', ''));
  const singleton = { ...record }; delete singleton.packages;
  assert.equal(promoteRecordFields(singleton, ['packageName']).packageName, 'stale');
  assert.ok(renderRecordMarkdown(singleton).startsWith('# Finding CVE-EMPTY (stale@9)\n'));
  for (const rendererVersion of [1, 2, 99, String(TRIAGE_RENDERER_VERSION)]) {
    assert.throws(() => renderRecordMarkdown(record, { rendererVersion }), TypeError);
    const records = path.join(dir, 'version-' + typeof rendererVersion + '-' + rendererVersion);
    const current = await writeTriageRecordArtifacts(records, record);
    const currentView = await readTriagePublication(records, current.jsonPath);
    assert.equal(currentView.text, renderRecordMarkdown(record));
    assert.equal(currentView.publication.rendererVersion, TRIAGE_RENDERER_VERSION);
    const wire = JSON.parse(await fs.readFile(current.jsonPath, 'utf8'));
    Object.assign(wire[TRIAGE_PUBLICATION_FIELD], { rendererVersion, markdownHash: sha(frozenLegacyText),
      markdownBytes: Buffer.byteLength(frozenLegacyText) });
    const bytes = JSON.stringify(wire);
    await fs.writeFile(current.jsonPath, bytes); await fs.writeFile(current.generationJsonPath, bytes);
    await fs.writeFile(current.mdPath, frozenLegacyText);
    await assert.rejects(readTriagePublication(records, current.jsonPath), error =>
      error.code === 'ERR_TRIAGE_RECORD_PUBLICATION' && /fresh records directory/u.test(error.message));
    await assert.rejects(writeTriageRecordArtifacts(records, record), { code: 'ERR_TRIAGE_RECORD_PUBLICATION' });
    assert.equal(await fs.readFile(current.jsonPath, 'utf8'), bytes);
    assert.equal(await fs.readFile(current.mdPath, 'utf8'), frozenLegacyText);
    const regeneratedRecords = path.join(records, 'fresh');
    const regenerated = await writeTriageRecordArtifacts(regeneratedRecords, record);
    assert.equal((await readTriagePublication(regeneratedRecords, regenerated.jsonPath)).text, renderRecordMarkdown(record));
  }
  assert.throws(() => renderRecordMarkdown(record, { rendererVersion: 99 }), TypeError);
} finally {
  assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Current triage renderer follows canonical package authority; obsolete and coerced renderer versions require regeneration.');
