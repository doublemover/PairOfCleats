#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  inspectExtractedProseState,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const findFileByName = async (root, targetName) => {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name === targetName) {
        return abs;
      }
    }
  }
  return null;
};

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-yield-profile-persisted-skip'
);
const srcDir = path.join(repoRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(docsDir, 'guide.pdf'), Buffer.from('persisted profile pdf body', 'utf8'));
for (let i = 1; i <= 8; i += 1) {
  await fs.writeFile(
    path.join(srcDir, `low-yield-${i}.js`),
    `const v${i} = ${i};\nexport default v${i};\n`
  );
}

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: { enabled: true },
      extractedProse: {
        lowYieldBailout: { enabled: false },
        prefilter: {
          yieldProfile: {
            enabled: true,
            minBuilds: 1,
            minProfileSamples: 4,
            minFamilySamples: 3,
            maxYieldRatio: 0,
            maxYieldedFiles: 0
          }
        }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const profilePath = await findFileByName(cacheRoot, 'extracted-prose-yield-profile.json');
assert.ok(profilePath, 'expected extracted prose yield profile artifact');
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
const profileEntries = Object.values(profile?.entries || {});
assert.ok(profileEntries.length >= 1, 'expected at least one persisted yield profile entry');
const jsFamilyEntry = profileEntries.find((entry) => entry?.families?.['.js|src']);
assert.ok(jsFamilyEntry, 'expected persisted .js|src family profile entry');
assert.ok(
  Number(jsFamilyEntry?.families?.['.js|src']?.observedFiles) >= 3,
  'expected persisted .js|src observed file count'
);
assert.equal(
  Number(jsFamilyEntry?.families?.['.js|src']?.yieldedFiles) || 0,
  0,
  'expected persisted .js|src yielded count to remain zero'
);

await fs.appendFile(path.join(srcDir, 'low-yield-1.js'), '\n// second-pass touch\n');
runExtractedProseBuild({ root, repoRoot, env });

const state = inspectExtractedProseState(repoRoot);
assert.ok(state?.indexDir, 'expected extracted-prose index dir after second run');
const { fileLists } = await readExtractedProseArtifacts(repoRoot);
const skipped = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const profileSkips = skipped.filter((entry) => entry?.reason === 'extracted-prose-yield-profile');
assert.ok(profileSkips.length >= 1, 'expected persisted profile pre-read skips on second run');
assert.ok(
  profileSkips.every((entry) => entry?.reasonCode === 'extracted-prose-yield-profile-low-yield-family'),
  'expected persisted profile skip reason codes'
);

console.log('extracted prose persisted yield-profile skip test passed');
