import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeTempDir } from '../../helpers/temp.js';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { sanitizeEmbeddedAssetText } from '../../../src/integrations/inference-history/embedded-assets.js';
import { projectArtifact, sanitizeArtifactJson } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { createArchiveLexicalAnalyzer } from '../../../src/integrations/inference-history/lexical-analyzer.js';
import { loadArchiveVocabulary, extractArchiveVocabulary } from '../../../src/integrations/inference-history/lexical-vocabulary.js';
import { parseHistoryQuery, matchesHistoryQuery } from '../../../src/integrations/inference-history/query.js';

const root = await fs.realpath(await makeTempDir('archive-lexical-'));
const dictionary = path.join(root, 'fixture-words.txt');
await fs.writeFile(dictionary, 'rain\nbow\nHTTP\nHTTP\n');
const config = { customFiles: [dictionary], byLanguage: { javascript: [dictionary], absent: [path.join(root, 'missing.txt')] } };
const vocabulary = await loadArchiveVocabulary(config);
assert.equal(vocabulary.receipt.wordCount, 3);
assert.deepEqual(vocabulary.receipt.languages, ['javascript']);
assert.equal(vocabulary.receipt.files[0].sha256, digest(await fs.readFile(dictionary)));
assert.equal(vocabulary.receipt.files[2].state, 'loaded');
assert.equal(vocabulary.receipt.files[1].state, 'unavailable');
await assert.rejects(loadArchiveVocabulary({ customFiles: ['relative.txt'] }), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
const analyzer = createArchiveLexicalAnalyzer(vocabulary);
assert.ok(analyzer.terms('HTTPServer NASA foo_bar').includes('http'));
assert.ok(analyzer.terms('HTTPServer NASA foo_bar').includes('nasa'));
assert.ok(analyzer.terms('HTTPServer NASA foo_bar').includes('foo_bar'));
assert.ok(analyzer.terms('rainbow').includes('rain'));
assert.ok(matchesHistoryQuery('HTTPServer', parseHistoryQuery('http', analyzer), 'strict'));
assert.equal(matchesHistoryQuery('HTTPServer', parseHistoryQuery('"http server"', analyzer), 'strict'), false);
assert.equal(matchesHistoryQuery('foo_bar', parseHistoryQuery('"foo bar"', analyzer), 'strict'), false);
assert.equal(matchesHistoryQuery('café foo_bar', parseHistoryQuery('cafe -foo_bar', analyzer), 'strict'), false);
const extracted = extractArchiveVocabulary([{ sanitizedText: 'NASA HTTPServer naïve 日本語', language: 'javascript', sourceSha256: 'a'.repeat(64) }], { minCount: 1 });
assert.ok(extracted.words.includes('nasa')); assert.ok(extracted.words.includes('http'));
assert.deepEqual(extracted.languages, ['javascript']);
assert.throws(() => extractArchiveVocabulary([{ text: '{"wrapper":"JSON"}' }]), /sanitizedText/);
for (const unsafe of [
  '<analysis>hidden internal reasoning</analysis>',
  '{"channel":"analysis","text":"hidden"}',
  'scratchpad hidden internal notes',
  'sk-' + 'x'.repeat(32),
  'password=synthetic-secret',
  'Bearer ' + 'x'.repeat(24)
]) {
  assert.throws(() => extractArchiveVocabulary([{ sanitizedText: unsafe }]), /trace omission and credential redaction/);
}
const safeRedacted = extractArchiveVocabulary([{ sanitizedText: 'public report [REDACTED credential] safely omitted' }], { minCount: 1 });
assert.ok(safeRedacted.words.includes('report'));
assert.ok(!safeRedacted.words.includes('synthetic-secret'));
const assetPayload = 'QUJD'.repeat(64);
for (const unsafe of [
  'const picture = "data:image/png;base64,' + assetPayload + '";',
  JSON.stringify({ image_base64: assetPayload, caption: 'public diagram' }),
  JSON.stringify({ nested: { attachment_base64: assetPayload } }),
  JSON.stringify({ attachment: 'data:application/octet-stream;base64,' + assetPayload })
]) assert.throws(() => extractArchiveVocabulary([{ sanitizedText: unsafe }]), /asset payloads|artifact sanitization/);
const sanitizedAssetText = sanitizeEmbeddedAssetText('public diagram data:image/png;base64,' + assetPayload);
const sanitizedAssetJson = JSON.stringify(sanitizeArtifactJson({ image_base64: assetPayload, caption: 'public diagram' }));
for (const sanitizedText of [sanitizedAssetText, sanitizedAssetJson]) {
  const ready = extractArchiveVocabulary([{ sanitizedText }], { minCount: 1 });
  assert.ok(ready.words.includes('diagram'));
  assert.equal(ready.assetPolicyVersion, 'archive-assets.v1');
  assert.equal(ready.analyzerVersion, 'archive-lexical.v3');
  assert.equal(ready.identifierVersion, 'dictionary-identifiers.v1');
  assert.ok(!ready.words.includes(assetPayload.toLowerCase()));
}
const legitimateCode = 'function render() { const encoded = "' + assetPayload + '"; return encoded; }';
assert.ok(extractArchiveVocabulary([{ sanitizedText: legitimateCode }], { minCount: 1 }).words.includes('render'));
assert.throws(() => extractArchiveVocabulary([{ sanitizedText: '[' + ' '.repeat(16 * 1024 * 1024) }]), /bounded sanitized content/);



const source = path.join(root, 'artifacts-0001.json');
const text = 'NASA HTTPServer foo_bar rainbow naïve 東京大学 exact quoted phrase';
await fs.writeFile(source, JSON.stringify(projectArtifact({ text, sourceSha256: 'a'.repeat(64), locator: 'HTTPServer_東京大学.js', kind: 'code' })));
const sourceBytes = await fs.readFile(source);
const options = { sources: [{ path: source, sha256: digest(sourceBytes) }], lexical: config, indexPath: path.join(root, 'collection.sqlite') };
for (let reopen = 0; reopen < 2; reopen++) {
  const service = await createLocalSourceHistoryService(options);
  assert.equal(service.localSource.lexical.wordCount, 3);
  for (const query of ['nasa', 'http', 'foo_bar', 'rain', 'naïve', '東京大学', '"exact quoted phrase"']) {
    const result = await service.search({ query });
    assert.equal(result.totalMatches, 1, query);
    assert.ok(result.hits[0].sourceRef && result.hits[0].snapshotRef);
  }
  for (const query of ['"http server"', '"foo bar"', 'nasa -foo_bar']) assert.equal((await service.search({ query })).totalMatches, 0, query);
  const metadata = await service.search({ query: 'http', searchField: 'path' });
  assert.equal(metadata.totalMatches, 1);
  assert.ok(metadata.hits[0].text.includes('HTTPServer_東京大学.js'));
  assert.equal(service.embeddingExecutionInfo(), null);
  await service.dispose();
}
assert.deepEqual(await fs.readFile(source), sourceBytes);
const fenceDb = new Database(options.indexPath);
const currentIdentity = fenceDb.prepare("SELECT value FROM vault_meta WHERE key='lexical_identity'").get().value;
const oldV2Identity = digest(JSON.stringify(['archive-lexical.v2', process.versions.icu, vocabulary.receipt.signature]));
assert.notEqual(currentIdentity, oldV2Identity);
fenceDb.prepare("UPDATE vault_meta SET value=? WHERE key='lexical_identity'").run(oldV2Identity);
fenceDb.close();
await assert.rejects(createLocalSourceHistoryService(options), { code: 'ERR_INFERENCE_HISTORY_UNAVAILABLE' });
const restoredDb = new Database(options.indexPath);
restoredDb.prepare("UPDATE vault_meta SET value=? WHERE key='lexical_identity'").run(currentIdentity);
restoredDb.close();
await fs.appendFile(dictionary, 'newword\n');
await assert.rejects(createLocalSourceHistoryService(options), { code: 'ERR_INFERENCE_HISTORY_UNAVAILABLE' });
console.log('archive analyzer identifiers, acronyms, dictionaries, Unicode, exact phrases/exclusions, discovery citations and persistent reopen passed');
