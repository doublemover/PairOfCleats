import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ledgerPath = path.join(repoRoot, 'docs', 'tooling', 'shared-module-ledger.json');
const reviewsDir = path.join(repoRoot, 'docs', 'tooling', 'shared-module-reviews');

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sharedFiles = Array.isArray(ledger?.census?.sharedFiles) ? ledger.census.sharedFiles : [];
const reviewFiles = fs.existsSync(reviewsDir)
  ? fs.readdirSync(reviewsDir).filter((file) => file.endsWith('.json')).sort()
  : [];

assert.ok(reviewFiles.length > 0, 'expected at least one shared-module review JSON artifact');

const ALLOWED_CLASSIFICATIONS = new Set([
  'keep',
  'split',
  'merge',
  'rename',
  'move',
  'document',
  'test',
  'optimize'
]);

const seenIssues = new Set();

for (const fileName of reviewFiles) {
  const reviewPath = path.join(reviewsDir, fileName);
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const issueId = String(review?.issueId || '').trim();
  assert.ok(issueId, `${fileName}: expected issueId`);
  assert.ok(!seenIssues.has(issueId), `${fileName}: duplicate review issueId ${issueId}`);
  seenIssues.add(issueId);

  const mdPath = reviewPath.replace(/\.json$/i, '.md');
  assert.ok(fs.existsSync(mdPath), `${fileName}: expected markdown companion ${path.basename(mdPath)}`);

  const expectedPaths = sharedFiles
    .filter((entry) => String(entry?.primaryIssue?.issueId || '') === issueId)
    .map((entry) => entry.path)
    .sort();
  const entries = Array.isArray(review?.entries) ? review.entries : [];
  const actualPaths = entries.map((entry) => entry.path).sort();
  assert.deepEqual(
    actualPaths,
    expectedPaths,
    `${fileName}: review entries must exactly match ledger-owned files for issue ${issueId}`
  );

  const seenPaths = new Set();
  for (const entry of entries) {
    assert.ok(typeof entry?.path === 'string' && entry.path.length > 0, `${fileName}: review entry missing path`);
    assert.ok(!seenPaths.has(entry.path), `${fileName}: duplicate entry for ${entry.path}`);
    seenPaths.add(entry.path);

    assert.ok(Number.isInteger(entry.consumerCount) && entry.consumerCount >= 0, `${fileName}: ${entry.path} missing consumerCount`);
    assert.ok(Array.isArray(entry.classifications) && entry.classifications.length > 0, `${fileName}: ${entry.path} missing classifications`);
    for (const classification of entry.classifications) {
      assert.ok(
        ALLOWED_CLASSIFICATIONS.has(classification),
        `${fileName}: ${entry.path} uses unknown classification ${classification}`
      );
    }
    assert.ok(
      typeof entry.consumerNotes === 'string' && entry.consumerNotes.trim().length > 0,
      `${fileName}: ${entry.path} missing consumerNotes`
    );
    assert.ok(
      typeof entry.recommendation === 'string' && entry.recommendation.trim().length > 0,
      `${fileName}: ${entry.path} missing recommendation`
    );
  }
}

console.log(`shared-module review artifacts validated: ${reviewFiles.length}`);
