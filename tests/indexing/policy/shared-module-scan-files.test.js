import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const scansDir = path.join(repoRoot, 'docs', 'tooling', 'shared-module-scans');

if (!fs.existsSync(scansDir)) {
  console.log('shared-module scan artifacts validated: 0');
  process.exit(0);
}

const scanFiles = fs.readdirSync(scansDir).filter((file) => file.endsWith('.json')).sort();
const seenIssues = new Set();

for (const fileName of scanFiles) {
  const scanPath = path.join(scansDir, fileName);
  const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));

  const issueId = String(scan?.issueId || '').trim();
  assert.ok(issueId, `${fileName}: expected issueId`);
  assert.ok(!seenIssues.has(issueId), `${fileName}: duplicate scan issueId ${issueId}`);
  seenIssues.add(issueId);

  const mdPath = scanPath.replace(/\.json$/i, '.md');
  assert.ok(fs.existsSync(mdPath), `${fileName}: expected markdown companion ${path.basename(mdPath)}`);

  assert.ok(typeof scan?.title === 'string' && scan.title.trim().length > 0, `${fileName}: missing title`);
  assert.ok(typeof scan?.scanDate === 'string' && scan.scanDate.trim().length > 0, `${fileName}: missing scanDate`);
  assert.ok(typeof scan?.scope === 'string' && scan.scope.trim().length > 0, `${fileName}: missing scope`);
  assert.ok(typeof scan?.summary === 'object' && scan.summary, `${fileName}: missing summary`);
  assert.ok(
    typeof scan.summary?.overallAssessment === 'string' && scan.summary.overallAssessment.trim().length > 0,
    `${fileName}: missing summary.overallAssessment`
  );
  assert.ok(Array.isArray(scan?.hotspotMatrix) && scan.hotspotMatrix.length > 0, `${fileName}: hotspotMatrix must be a non-empty array`);
  assert.ok(Array.isArray(scan?.mappings) && scan.mappings.length > 0, `${fileName}: mappings must be a non-empty array`);
  assert.ok(Array.isArray(scan?.localExceptions), `${fileName}: localExceptions must be an array`);

  for (const hotspot of scan.hotspotMatrix) {
    assert.ok(typeof hotspot?.name === 'string' && hotspot.name.trim().length > 0, `${fileName}: hotspot missing name`);
    assert.ok(
      typeof hotspot?.recommendedAction === 'string' && hotspot.recommendedAction.trim().length > 0,
      `${fileName}: hotspot ${hotspot?.name || '(unknown)'} missing recommendedAction`
    );
    assert.ok(
      typeof hotspot?.whyThisWayIsBest === 'string' && hotspot.whyThisWayIsBest.trim().length > 0,
      `${fileName}: hotspot ${hotspot?.name || '(unknown)'} missing whyThisWayIsBest`
    );
  }
}

console.log(`shared-module scan artifacts validated: ${scanFiles.length}`);
