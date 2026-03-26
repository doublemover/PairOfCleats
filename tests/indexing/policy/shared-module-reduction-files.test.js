import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reductionsDir = path.join(repoRoot, 'docs', 'tooling', 'shared-module-reductions');

assert.ok(fs.existsSync(reductionsDir), 'expected shared-module reduction artifacts directory');

const reductionFiles = fs.readdirSync(reductionsDir).filter((file) => file.endsWith('.json')).sort();
assert.ok(reductionFiles.length > 0, 'expected at least one shared-module reduction JSON artifact');

const seenIssues = new Set();

for (const fileName of reductionFiles) {
  const reductionPath = path.join(reductionsDir, fileName);
  const reduction = JSON.parse(fs.readFileSync(reductionPath, 'utf8'));

  const issueId = String(reduction?.issueId || '').trim();
  assert.ok(issueId, `${fileName}: expected issueId`);
  assert.ok(!seenIssues.has(issueId), `${fileName}: duplicate reduction issueId ${issueId}`);
  seenIssues.add(issueId);

  const mdPath = reductionPath.replace(/\.json$/i, '.md');
  assert.ok(fs.existsSync(mdPath), `${fileName}: expected markdown companion ${path.basename(mdPath)}`);

  assert.ok(typeof reduction?.title === 'string' && reduction.title.trim().length > 0, `${fileName}: missing title`);
  assert.ok(typeof reduction?.reducedAt === 'string' && reduction.reducedAt.trim().length > 0, `${fileName}: missing reducedAt`);
  assert.ok(Array.isArray(reduction?.sourceIssues) && reduction.sourceIssues.length > 0, `${fileName}: missing sourceIssues`);
  assert.ok(
    Array.isArray(reduction?.priorityBatches) && reduction.priorityBatches.length > 0,
    `${fileName}: priorityBatches must be a non-empty array`
  );
  assert.ok(Array.isArray(reduction?.deferOrDrop), `${fileName}: deferOrDrop must be an array`);

  for (const batch of reduction.priorityBatches) {
    assert.ok(typeof batch?.batchId === 'string' && batch.batchId.trim().length > 0, `${fileName}: batch missing batchId`);
    assert.ok(typeof batch?.priority === 'string' && batch.priority.trim().length > 0, `${fileName}: batch ${batch?.batchId || '(unknown)'} missing priority`);
    assert.ok(Array.isArray(batch?.categories) && batch.categories.length > 0, `${fileName}: batch ${batch.batchId} missing categories`);
    assert.ok(Array.isArray(batch?.dependsOn), `${fileName}: batch ${batch.batchId} missing dependsOn`);
    assert.ok(typeof batch?.whyNow === 'string' && batch.whyNow.trim().length > 0, `${fileName}: batch ${batch.batchId} missing whyNow`);
    assert.ok(Array.isArray(batch?.items) && batch.items.length > 0, `${fileName}: batch ${batch.batchId} missing items`);
    for (const item of batch.items) {
      assert.ok(typeof item?.title === 'string' && item.title.trim().length > 0, `${fileName}: batch ${batch.batchId} item missing title`);
      assert.ok(Array.isArray(item?.paths) && item.paths.length > 0, `${fileName}: batch ${batch.batchId} item ${item?.title || '(unknown)'} missing paths`);
      assert.ok(
        typeof item?.bestFix === 'string' && item.bestFix.trim().length > 0,
        `${fileName}: batch ${batch.batchId} item ${item?.title || '(unknown)'} missing bestFix`
      );
    }
  }
}

console.log(`shared-module reduction artifacts validated: ${reductionFiles.length}`);
