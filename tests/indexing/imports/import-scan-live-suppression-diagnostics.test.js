import assert from 'node:assert/strict';

import { logUnresolvedImportSamples } from '../../../src/index/build/indexer/steps/relations/import-scan.js';

const writes = [];
const originalWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  if (typeof encoding === 'function') encoding();
  if (typeof callback === 'function') callback();
  return true;
};

try {
  const suppression = logUnresolvedImportSamples({
    samples: [{
      importer: 'src/main.js',
      specifier: './missing.js',
      reasonCode: 'IMP_U_RESOLVER_GAP',
      failureCause: 'resolver_gap',
      confidence: 0.92
    }],
    suppressed: 0,
    unresolvedTotal: 4,
    taxonomy: {
      total: 4,
      actionable: 1,
      liveSuppressed: 1,
      gateSuppressed: 0,
      actionableRate: 0.25,
      actionableUnresolvedRate: 0.25,
      parserArtifactRate: 0,
      resolverGapRate: 0.25,
      resolverBudgetExhausted: 0,
      resolverBudgetExhaustedByType: {},
      reasonCodes: {
        IMP_U_RESOLVER_GAP: 1
      },
      failureCauses: {
        resolver_gap: 1
      },
      resolverStages: {
        resolver: 1
      },
      resolverAdapters: {
        tsconfig: 1
      },
      actionableHotspots: [{
        importer: 'src/main.js',
        count: 1
      }],
      actionableByLanguage: {
        js: 1
      }
    },
    alreadyNormalized: true
  });

  assert.equal(suppression?.suppressionPolicy, 'live');
  assert.equal(suppression?.suppressedCount, 1);
  assert.equal(suppression?.degradedRun, true);
  assert.equal(suppression?.visibleSampleCount, 1, 'expected degraded runs to retain a bounded unresolved sample');
  assert.deepEqual(suppression?.omittedFailureCauses, ['resolver_gap']);

  const output = writes.join('');
  assert.match(output, /retaining 1 bounded unresolved sample\(s\) despite live suppression/i);
  assert.match(output, /\[imports\] suppression: policy=live count=1 degraded=1 visible=1 total=4 actionable=1 omittedFailureCauses=resolver_gap/);

  console.log('import scan live suppression diagnostics test passed');
} finally {
  process.stderr.write = originalWrite;
}
