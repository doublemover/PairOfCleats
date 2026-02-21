#!/usr/bin/env node
import { mergeCoverageEntries, buildCoverageArtifact } from '../../../tools/testing/coverage/index.js';

const merged = mergeCoverageEntries([
  {
    entries: [
      { path: 'src/b.js', coveredRanges: 2, totalRanges: 4 },
      { path: 'src/a.js', coveredRanges: 1, totalRanges: 2 }
    ]
  },
  {
    entries: [
      { path: 'src/a.js', coveredRanges: 3, totalRanges: 6 }
    ]
  }
]);

if (merged.length !== 2) {
  console.error('coverage merge test failed: expected two merged rows');
  process.exit(1);
}
if (merged[0].path !== 'src/a.js' || merged[1].path !== 'src/b.js') {
  console.error('coverage merge test failed: expected stable sorted order by path');
  process.exit(1);
}
if (merged[0].coveredRanges !== 3 || merged[0].totalRanges !== 6) {
  console.error('coverage merge test failed: expected max merge for identical paths');
  process.exit(1);
}

const artifact = buildCoverageArtifact({ runId: 'run-1', entries: merged });
if (artifact.summary.files !== 2) {
  console.error('coverage merge test failed: expected summary file count');
  process.exit(1);
}
if (artifact.summary.coveredRanges !== 5 || artifact.summary.totalRanges !== 10) {
  console.error('coverage merge test failed: expected summary totals');
  process.exit(1);
}

console.log('coverage merge test passed');
