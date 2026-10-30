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
  const legacy = { ...record }; delete legacy.packages;
  assert.equal(promoteRecordFields(legacy, ['packageName']).packageName, 'stale');
  assert.ok(renderRecordMarkdown(legacy).startsWith('# Finding CVE-EMPTY (stale@9)\n'));
  for (const rendererVersion of [1, 2]) {
    assert.equal(renderRecordMarkdown(record, { rendererVersion }), frozenLegacyText,
      'each old renderer retains its original complete wire bytes');
    const records = path.join(dir, 'version-' + rendererVersion);
    const old = await writeTriageRecordArtifacts(records, record);
    const wire = JSON.parse(await fs.readFile(old.jsonPath, 'utf8'));
    Object.assign(wire[TRIAGE_PUBLICATION_FIELD], { rendererVersion, markdownHash: sha(frozenLegacyText),
      markdownBytes: Buffer.byteLength(frozenLegacyText) });
    const bytes = JSON.stringify(wire);
    await fs.writeFile(old.jsonPath, bytes); await fs.writeFile(old.generationJsonPath, bytes);
    await fs.writeFile(old.mdPath, frozenLegacyText);
    assert.equal((await readTriagePublication(records, old.jsonPath)).text, frozenLegacyText,
      'the real strict reader reconstructs the declared legacy renderer');
    const fresh = await writeTriageRecordArtifacts(records, record);
    assert.notEqual(fresh.generation, old.generation);
    const current = await readTriagePublication(records, fresh.jsonPath);
    assert.equal(current.publication.rendererVersion, TRIAGE_RENDERER_VERSION);
    assert.equal(current.text, renderRecordMarkdown(record));
    assert.equal(await fs.readFile(old.mdPath, 'utf8'), frozenLegacyText, 'explicit republish never rewrites old immutable bytes');
    const unknown = JSON.parse(await fs.readFile(fresh.jsonPath, 'utf8'));
    unknown[TRIAGE_PUBLICATION_FIELD].rendererVersion = 99;
    await fs.writeFile(fresh.jsonPath, JSON.stringify(unknown));
    await assert.rejects(readTriagePublication(records, fresh.jsonPath), { code: 'ERR_TRIAGE_RECORD_PUBLICATION' });
  }
  assert.throws(() => renderRecordMarkdown(record, { rendererVersion: 99 }), TypeError);
} finally {
  assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Renderer3 follows canonical package authority while declared renderer1/2 byte reconstruction stays exact and unknown versions fail.');
