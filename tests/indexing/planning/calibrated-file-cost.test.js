import assert from 'node:assert/strict';
import { createPerfProfile, recordFileMetric, finalizePerfProfile, estimateFileCost } from '../../../src/index/build/perf-profile.js';
const profile = createPerfProfile();
recordFileMetric(profile, { languageId: 'js', bytes: 100, lines: 10, durationMs: 10 });
finalizePerfProfile(profile);
assert.equal(estimateFileCost({ perfProfile: profile, languageId: 'js', bytes: 100, lines: 10 }), 10);
assert.equal(estimateFileCost({ perfProfile: profile, languageId: 'js', bytes: 200, lines: 20 }), 20);
console.log('calibrated file cost passed');

const mixed = createPerfProfile();
for (const durationMs of [10, 30]) recordFileMetric(mixed, { languageId: 'js', bytes: 100, lines: 10, durationMs });
finalizePerfProfile(mixed);
assert.equal(estimateFileCost({ perfProfile: mixed, languageId: 'js', bytes: 100, lines: 10 }), 20);
assert.equal(estimateFileCost({ perfProfile: mixed, languageId: 'js', bytes: 200, lines: 20 }), 40);
