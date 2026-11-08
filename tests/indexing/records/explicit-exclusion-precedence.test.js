import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecordsClassifier } from '../../../src/index/build/records.js';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createWatchPathClassifier } from '../../../src/index/build/watch/classify-path.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const { dir: root } = await prepareIsolatedTestCacheDir('record-exclusion-precedence');
const config = { includeGlobs: ['private/**', 'included/**'], excludeGlobs: ['private/**'] };
const classifier = createRecordsClassifier({ root, config });
const samples = ['FATAL: incident', 'Traceback (most recent call last):', 'at main (x.js:1:2)',
  '2026-10-25 01:02:03 one\n2026-10-25 01:02:04 two\n2026-10-25 01:02:05 three'];
for (const ext of ['.txt', '.text', '', '.log']) for (const sampleText of samples) {
  const input = { relPath: 'private/incident' + ext, ext, sampleText };
  assert.equal(classifier.classifyPath(input).state, 'excluded');
  assert.equal(classifier.shouldSniff(input), false);
  assert.equal(classifier.classify(input), null, 'content cannot reverse an explicit records-only exclusion');
  const unsampled = { ...input, get sampleText() { throw new Error('excluded samples must not be inspected'); } };
  assert.equal(classifier.classify(unsampled), null);
}
for (const input of [{ relPath: 'included/incident.txt', ext: '.txt' }, { relPath: 'allowed/incident.log', ext: '.log' }]) {
  assert.equal(classifier.classifyPath(input).state, 'matched'); assert.ok(classifier.classify(input));
  assert.equal(classifier.shouldSniff(input), false, 'matched path routes need no content sniff');
}
assert.equal(classifier.shouldSniff({ relPath: 'allowed/incident.txt', ext: '.txt' }), true);
assert.ok(classifier.classify({ relPath: 'allowed/incident.txt', ext: '.txt', sampleText: samples[0] }));
await fs.mkdir(path.join(root, 'private')); await fs.mkdir(path.join(root, 'allowed'));
const excluded = path.join(root, 'private', 'incident.txt');
await fs.writeFile(excluded, samples[0]); await fs.writeFile(path.join(root, 'allowed', 'incident.txt'), samples[0]);
const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: {} });
const open = fs.open; let excludedOpens = 0;
try {
  fs.open = async (file, ...args) => {
    if (path.relative(path.resolve(String(file)), excluded) === '') excludedOpens++;
    return open.call(fs, file, ...args);
  };
  await preprocessFiles({ root, modes: ['prose', 'records'], recordsConfig: { ...config, sniffBytes: 0 }, ignoreMatcher, concurrency: 1 });
  const baselineOpens = excludedOpens; excludedOpens = 0;
  const result = await preprocessFiles({ root, modes: ['prose', 'records'], recordsConfig: config, ignoreMatcher, concurrency: 1 });
  assert.equal(result.entriesByMode.records.some(entry => entry.rel === 'private/incident.txt'), false);
  assert.ok(result.entriesByMode.records.some(entry => entry.rel === 'allowed/incident.txt'));
  assert.ok(result.entriesByMode.prose.some(entry => entry.rel === 'private/incident.txt'),
    'records-only exclusion preserves legitimate prose admission');
  assert.equal(excludedOpens, baselineOpens, 'enabling record sniffing adds no read beyond ordinary prose admission for an excluded input');
} finally { fs.open = open; }
const excludedPaths = [];
for (const ext of ['.txt', '.text', '', '.log']) {
  const file = path.join(root, 'private', 'incident' + ext);
  await fs.writeFile(file, samples.join('\n')); excludedPaths.push(file);
}
const counts = new Map(), key = file => path.resolve(String(file));
try {
  fs.open = async (file, ...args) => { counts.set(key(file), (counts.get(key(file)) || 0) + 1); return open.call(fs, file, ...args); };
  const initial = recordsConfig => preprocessFiles({ root, modes: ['prose', 'records'], recordsConfig, ignoreMatcher, concurrency: 1 });
  await initial({ ...config, sniffBytes: 0 }); const baseline = new Map(counts); counts.clear();
  const fresh = await initial(config);
  for (const file of excludedPaths) {
    assert.equal(counts.get(key(file)) || 0, baseline.get(key(file)) || 0, 'excluded initial inputs add no sniff reads for any admitted extension');
    assert.ok(!fresh.entriesByMode.records.some(entry => entry.abs === file));
  }
  const watch = (recordsConfig, normalizedRecordsRoot = null) => createWatchPathClassifier({ root,
    canonicalRoot: toRealPathSync(root), normalizedRecordsRoot, maxDepthCap: null, ignoreMatcher,
    recordsClassifier: createRecordsClassifier({ root, config: recordsConfig }), maxFileBytes: null, fileCaps: null });
  counts.clear(); const zero = watch({ ...config, sniffBytes: 0 });
  for (const file of excludedPaths) assert.equal((await zero(file)).record, null);
  const ordinary = new Map(counts); counts.clear(); const full = watch(config);
  for (const file of excludedPaths) {
    assert.equal((await full(file)).record, null);
    assert.equal(counts.get(key(file)) || 0, ordinary.get(key(file)) || 0, 'watch adds no excluded record sniff read beyond ordinary shebang admission');
  }
  assert.equal((await full(path.join(root, 'allowed', 'incident.txt'))).record.recordType, 'stack');
  const explicitRoot = watch(config, toRealPathSync(path.join(root, 'private')));
  assert.equal((await explicitRoot(excludedPaths[0])).record.reason, 'records-dir', 'separate configured-root authority remains explicit');
} finally { fs.open = open; }
console.log('records path exclusion is terminal before initial/watch sniff admission');
