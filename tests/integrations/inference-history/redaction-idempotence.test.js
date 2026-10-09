import assert from 'node:assert/strict';
import { redactHistoryText, DEFAULT_LIMITS } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { normalizeHistoryRecord } from '../../../src/integrations/inference-history/records.js';
for (const original of [
  'password=synthetic-private-value; visible cobalt',
  'api_key: "synthetic-private-value", visible cobalt',
  'https://fixture.invalid/?token=synthetic-private-value&visible=cobalt',
  'Bearer syntheticlongtoken123456'
]) {
  const sanitized = redactHistoryText(original);
  assert.ok(!sanitized.includes('synthetic-private-value'));
  assert.equal(redactHistoryText(sanitized), sanitized, 'redaction must be idempotent');
  const records = projectArtifact({ text: original, sourceSha256: 'a'.repeat(64), locator: 'fixture.txt' });
  assert.equal(records.length, 1);
  const normalized = normalizeHistoryRecord(records[0], 'recovered_artifact', DEFAULT_LIMITS);
  assert.equal(normalized.nodes[0].text, records[0].body);
  assert.equal(records[0].provenance.transformation.kind, 'redacted_coarse');
}
console.log('credential redaction remains idempotent and projected sanitized evidence imports safely');
