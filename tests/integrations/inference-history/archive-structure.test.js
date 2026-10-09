import assert from 'node:assert/strict';
import { archiveStructuralSpans, classifyArchiveSource, reassembleArchiveFragments } from '../../../src/integrations/inference-history/archive-structure.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { normalizeHistoryRecord } from '../../../src/integrations/inference-history/records.js';
import { DEFAULT_LIMITS } from '../../../src/integrations/inference-history/common.js';
const hash = 'a'.repeat(64);
const text = '/** HTTPParser preserves API_ID. */\nfunction HTTPParser(){return "café 🚀";}\n\n/** Parse the second request. */\nfunction parseSecond(){return 2;}';
const spans = archiveStructuralSpans(text, { locator: 'src/parser.mjs', kind: 'code', chunkChars: 1000, overlapChars: 200 });
assert.equal(spans.length, 2);
assert.ok(spans[0].text.includes('HTTPParser preserves API_ID'));
assert.ok(spans[1].text.includes('Parse the second request'));
assert.ok(!spans[0].text.includes('parseSecond'));
assert.ok(spans[0].title.includes('HTTPParser'));
assert.equal(spans.map(row => row.text).join(''), text);
for (const row of spans) assert.equal(row.text, text.slice(row.start, row.end));
const markdown = '# Guide\nBefore fence.\n\n```js\n# pretendHeading\nfunction HTTPParser() { return "API_ID"; }\n```\n\n# Next\nAfter fence.';
const md = archiveStructuralSpans(markdown, { locator: 'docs/guide.md', chunkChars: 1000, overlapChars: 200 });
assert.ok(md.some(row => row.text.includes('```js') && row.text.includes('pretendHeading') && row.text.trimEnd().endsWith('```') && !row.text.includes('# Next')));
assert.ok(md.some(row => row.title.includes('Next')));
const long = text.repeat(8);
const records = projectArtifact({ text: long, sourceSha256: hash, locator: 'src/parser.mjs', kind: 'code', chunkChars: 256 });
const assembled = reassembleArchiveFragments([...records].reverse());
assert.equal(assembled.length, 1); assert.equal(assembled[0].text, long);
assert.equal(assembled[0].fragments.length, records.length);
assert.equal(reassembleArchiveFragments([...records, records[0]])[0].text, long);
assert.equal(reassembleArchiveFragments(records.filter((_, index) => index !== 1)).length, 2);
assert.throws(() => reassembleArchiveFragments([...records, { ...records[0], body: 'Z' + records[0].body.slice(1) }]), /Overlapping/);
const normalized = normalizeHistoryRecord(records[1], 'recovered_artifact', DEFAULT_LIMITS);
assert.equal(normalized.nodes[0].sourceDetails.sanitizedStart, 256);
assert.equal(normalized.nodes[0].sourceDetails.language, 'javascript');
assert.throws(() => normalizeHistoryRecord({ ...records[0], provenance: { ...records[0].provenance, chunk_end: 255 } }, 'recovered_artifact', DEFAULT_LIMITS));
for (const kind of ['metadata', 'tool_activity']) assert.equal(classifyArchiveSource({ kind }).proposedSemanticEligibility, false);
assert.equal(classifyArchiveSource({ locator: 'generated/API_ID.ts', text: 'important searchable facts' }).lexicalOnlyReason, 'generated_material_proposal');
assert.equal(classifyArchiveSource({ locator: 'config/settings.yaml' }).format, 'config');
const bounded = archiveStructuralSpans('long sentence 🚀 '.repeat(500), { chunkChars: 100, overlapChars: 20 });
assert.ok(bounded.every(row => row.text.length <= 100));
assert.ok(bounded.every(row => !/[\uD800-\uDBFF]$/.test(row.text) && !/^[\uDC00-\uDFFF]/.test(row.text)));
console.log('archive structural reconstruction, comments, Markdown fences, Unicode offsets and lexical-only preservation passed');



const opaque = classifyArchiveSource({ locator: 'recovered/source.dat', text });
assert.equal(opaque.language, 'javascript'); assert.equal(opaque.languageConfidence, 'medium');
assert.equal(opaque.classificationReason, 'javascript_function_heuristic');
assert.equal(classifyArchiveSource({ locator: 'opaque.dat', text: 'Ordinary research prose.' }).fallbackReason, 'no_confident_structure');
const redacted = projectArtifact({ text: 'before sk-abcdefghijklmnop after', sourceSha256: hash, locator: 'x.txt' })[0];
assert.equal(redacted.provenance.offset_basis, 'sanitized_utf16');
assert.equal(redacted.provenance.transformation.kind, 'redacted_coarse');
assert.equal(redacted.provenance.transformation.original_end, 32);
assert.equal(redacted.provenance.transformation.sanitized_end, redacted.body.length);
assert.equal(normalizeHistoryRecord(redacted, 'recovered_artifact', DEFAULT_LIMITS).nodes[0].sourceDetails.offsetBasis, 'sanitized_utf16');
assert.equal(classifyArchiveSource({ kind: 'metadata' }).semanticEligible, true);


for (const field of ['offset_basis', 'transformation', 'projection_version']) {
  const provenance = { ...records[0].provenance }; delete provenance[field];
  assert.throws(() => normalizeHistoryRecord({ ...records[0], provenance }, 'recovered_artifact', DEFAULT_LIMITS), /Invalid inference-history evidence record/);
}
const password = projectArtifact({ text: 'before password=SuperSecret after', sourceSha256: hash, locator: 'credentials.txt' })[0];
assert.equal(normalizeHistoryRecord(password, 'recovered_artifact', DEFAULT_LIMITS).nodes[0].sourceDetails.transformation.kind, 'redacted_coarse');
const unicodeText = 'caf\u00e9 \u{1F680} '.repeat(100);
const unicodeSpans = archiveStructuralSpans(unicodeText, { chunkChars: 100, overlapChars: 20 });
assert.ok(unicodeSpans.every(row => !/[\uD800-\uDBFF]$/.test(row.text) && !/^[\uDC00-\uDFFF]/.test(row.text)));
assert.equal(unicodeSpans[0].start, 0);
assert.equal(unicodeSpans.at(-1).end, unicodeText.length);

assert.throws(() => normalizeHistoryRecord({ ...records[0], provenance: { ...records[0].provenance,
  transformation: { ...records[0].provenance.transformation, original_end: records[0].provenance.total_chars + 1 }
} }, 'recovered_artifact', DEFAULT_LIMITS), /Invalid inference-history evidence record/);

const jsonText = JSON.stringify(Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['setting_' + i, 'value_' + i])), null, 2);
const jsonSpans = archiveStructuralSpans(jsonText, { locator: 'settings.json', chunkChars: 1000, overlapChars: 200 });
assert.ok(jsonSpans.length < 10);
assert.equal(jsonSpans.map(row => row.text).join(''), jsonText);
assert.ok(jsonSpans.every(row => row.text.length <= 1000));
const yamlText = 'first: 1\nsecond: 2\nsection:\n  child: true\n  other: false\nlast: 3\n';
const yamlSpans = archiveStructuralSpans(yamlText, { locator: 'settings.yaml', chunkChars: 1000, overlapChars: 200 });
assert.equal(yamlSpans.length, 1); assert.equal(yamlSpans[0].text, yamlText);
const proseText = 'One short paragraph about the HTTPParser interface.\n\n'.repeat(30);
const proseSpans = archiveStructuralSpans(proseText, { locator: 'notes.txt', chunkChars: 1000, overlapChars: 200 });
assert.equal(proseSpans.length, 2); assert.equal(proseSpans.map(row => row.text).join(''), proseText);
assert.ok(proseSpans.every(row => row.text.length <= 1000));
const codeWithBlank = text + '\n\n';
const packedCode = archiveStructuralSpans(codeWithBlank, { locator: 'parser.js', chunkChars: 1000, overlapChars: 200 });
assert.equal(packedCode.length, 2); assert.equal(packedCode.map(row => row.text).join(''), codeWithBlank);
assert.ok(packedCode.every(row => row.text.trim()));
const sameHeading = '# Repeated\nfirst section.\n\n# Repeated\nsecond section.';
assert.equal(archiveStructuralSpans(sameHeading, { locator: 'guide.md', chunkChars: 1000, overlapChars: 200 }).length, 2);
const logs = 'INFO first record\n  first continuation\nINFO second record\n  second continuation\n';
const logSpans = archiveStructuralSpans(logs, { locator: 'service.log', chunkChars: 1000, overlapChars: 200 });
assert.equal(logSpans.length, 2); assert.equal(logSpans.map(row => row.text).join(''), logs);

const opaqueLocator = 'collection/42/file_' + 'a'.repeat(32) + '.dat';
const opaqueSpans = archiveStructuralSpans(text, { locator: opaqueLocator, kind: 'code' });
assert.ok(opaqueSpans[0].title.includes('HTTPParser'));
assert.ok(!opaqueSpans[0].title.includes('file_'));
const activityTitle = archiveStructuralSpans('Visible activity report.', { locator: opaqueLocator + '/activity/10', kind: 'activity' })[0].title;
assert.equal(activityTitle, 'Activity');
assert.ok(archiveStructuralSpans('Ordinary prose.', { locator: 'notes/meeting-record' })[0].title.includes('notes/meeting-record'));
