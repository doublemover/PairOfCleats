#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const CURRENT_READINESS_GATE_LOG = 'temp/validation/readiness-gate-current-technical-validation-20260522.log';
const LATEST_EVIDENCE_CITATION_LOG = 'temp/validation/readiness-evidence-citation-final-20260522.log';
const matrixDir = path.join(root, 'tests', 'lang', 'matrix');

const readJson = (fileName) => (
  JSON.parse(fs.readFileSync(path.join(matrixDir, fileName), 'utf8'))
);

const toRowMap = (rows, key = 'id') => new Map(rows.map((row) => [row[key], row]));

const languageProfiles = readJson('usr-language-profiles.json').rows;
const languageVersions = readJson('usr-language-version-policy.json').rows;
const languageEmbeddings = readJson('usr-language-embedding-policy.json').rows;
const languageShards = readJson('usr-language-batch-shards.json').rows;
const conformanceLevels = readJson('usr-conformance-levels.json').rows;
const fixtureGovernance = readJson('usr-fixture-governance.json').rows;
const frameworkProfiles = readJson('usr-framework-profiles.json').rows;
const frameworkEdgeCases = readJson('usr-framework-edge-cases.json').rows;
const sloBudgets = readJson('usr-slo-budgets.json').rows;
const benchmarkPolicies = readJson('usr-benchmark-policy.json').rows;

const languageProfileById = toRowMap(languageProfiles);
const languageVersionById = toRowMap(languageVersions, 'languageId');
const languageEmbeddingById = toRowMap(languageEmbeddings, 'languageId');
const conformanceByProfile = new Map(conformanceLevels.map((row) => [`${row.profileType}:${row.profileId}`, row]));
const fixtureById = toRowMap(fixtureGovernance, 'fixtureId');
const frameworkProfileById = toRowMap(frameworkProfiles);
const frameworkEdgeCaseById = toRowMap(frameworkEdgeCases);
const sloBudgetByLane = toRowMap(sloBudgets, 'laneId');

const shardByLanguage = new Map();
for (const shard of languageShards) {
  for (const languageId of shard.languageIds || []) {
    shardByLanguage.set(languageId, shard);
  }
}

const readDocs = (subdir) => {
  const dir = path.join(root, 'docs', 'specs', 'usr', subdir);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !['README.md', 'TEMPLATE.md'].includes(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      id: name.replace(/\.md$/, ''),
      path: path.join(dir, name),
      text: fs.readFileSync(path.join(dir, name), 'utf8')
    }));
};

const checkboxState = (text, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^- \\[([ xX])\\] ${escaped}$`, 'm'));
  assert.ok(match, `missing checklist row: ${label}`);
  return match[1].toLowerCase();
};

const assertChecked = (text, label) => {
  assert.equal(checkboxState(text, label), 'x', `expected checked row: ${label}`);
};

const sectionText = (text, heading) => {
  const headingLine = `## ${heading}`;
  const start = text.indexOf(headingLine);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const bodyStart = text.indexOf('\n', start);
  assert.notEqual(bodyStart, -1, `malformed section: ${heading}`);
  const nextHeading = text.indexOf('\n## ', bodyStart + 1);
  return text.slice(bodyStart + 1, nextHeading === -1 ? text.length : nextHeading);
};

const backtickValues = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const backtickValuesForKey = (text, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^- \`${escaped}\`: (.+)$`, 'm'));
  assert.ok(match, `missing keyed value row: ${key}`);
  return backtickValues(match[1]);
};

const assertFixtureFamiliesCoverConformance = ({ profileType, profileId, fixtureIds }) => {
  const conformanceRow = conformanceByProfile.get(`${profileType}:${profileId}`);
  assert.ok(conformanceRow, `missing conformance row for ${profileType}:${profileId}`);

  const fixtureFamilies = new Set();
  for (const fixtureId of fixtureIds) {
    const fixture = fixtureById.get(fixtureId);
    assert.ok(fixture, `${profileType} ${profileId} fixture missing governance row: ${fixtureId}`);
    for (const family of fixture.families || []) {
      fixtureFamilies.add(family);
    }
  }

  for (const requiredFamily of conformanceRow.requiredFixtureFamilies || []) {
    assert.ok(
      fixtureFamilies.has(requiredFamily),
      `${profileType} ${profileId} fixture families must cover ${requiredFamily}`
    );
  }
};

const assertOrderManifestExists = (shard) => {
  const manifestPath = path.join(root, shard.orderManifest.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(manifestPath), true, `missing order manifest for ${shard.id}`);
  const validationPath = path.join(path.dirname(manifestPath), 'validation.test.js');
  assert.equal(fs.existsSync(validationPath), true, `missing executable validation test for ${shard.id}`);
};

const archivedApprovalLockPath = path.join(root, 'docs', 'archived', 'usr-rollout-approval-lock.md');
assert.equal(fs.existsSync(archivedApprovalLockPath), true, 'former USR approval lock must be archived');
const archivedApprovalLockText = fs.readFileSync(archivedApprovalLockPath, 'utf8');
assert.match(
  archivedApprovalLockText,
  /^# DEPRECATED/m,
  'archived USR approval lock must carry a deprecation header'
);
assert.match(
  archivedApprovalLockText,
  /not an active release blocker|is not a release blocker/i,
  'archived USR approval lock must say it is not an active release blocker'
);
assert.equal(
  fs.existsSync(path.join(root, 'docs', 'specs', 'usr-rollout-approval-lock.md')),
  false,
  'USR approval lock must not remain an active spec'
);

const unifiedSyntaxText = fs.readFileSync(
  path.join(root, 'docs', 'specs', 'unified-syntax-representation.md'),
  'utf8'
);
for (const scorecardLabel of [
  '100% registry language profile coverage',
  '100% required framework profile coverage',
  '0 unresolved schema drift findings',
  '0 ID grammar violations',
  '0 edge endpoint constraint violations',
  'deterministic rerun diff is empty for required entities',
  'capability downgrade diagnostics within approved threshold budget',
  'no high-severity unresolved diagnostics in required conformance levels'
]) {
  assertChecked(unifiedSyntaxText, scorecardLabel);
}
assert.match(
  unifiedSyntaxText,
  /Production-path enablement is now governed by standard release readiness validation rather than the archived Gate C role-signoff lock/,
  'USR scorecard must tie production-path enablement to technical readiness, not role signoff'
);

const roadmapText = fs.readFileSync(path.join(root, 'docs', 'roadmap.md'), 'utf8');
assert.match(
  roadmapText,
  /Gate B1-B7 technical, compatibility, matrix, conformance, observability, quality, and security-risk controls/,
  'roadmap must anchor Gate B1-B7 status named by rollout migration policy'
);
assert.match(
  roadmapText,
  /temp\/validation\/release-evidence-current-handoff-final-validation-20260521\.log/,
  'roadmap must cite the current release evidence handoff final validation log'
);

assert.match(
  roadmapText,
  /Gate C technical rollout criteria are locally satisfied for the current branch/,
  'roadmap must record USR Gate C technical criteria as locally satisfied'
);
assert.doesNotMatch(
  roadmapText,
  /usrApproval\.pending|Approval state: pending|Readiness report approved\.|Test rollout authorized\.|conformance rollout authorized\./,
  'roadmap must not keep non-technical approval blockers as active status'
);

const releasePlanText = fs.readFileSync(path.join(root, 'docs', 'roadmap-release-validation-plan.md'), 'utf8');
assert.match(
  releasePlanText,
  /Local technical lanes have no known blocker/,
  'release validation plan must not classify archived role signoff as a technical blocker'
);
assert.match(
  releasePlanText,
  /tools\/release\/readiness-gate\.js.*technical release evidence/s,
  'release validation plan must document readiness-gate technical evidence enforcement'
);
assert.ok(
  releasePlanText.includes(CURRENT_READINESS_GATE_LOG),
  'release validation plan must cite the current readiness-gate validation log'
);
assert.ok(
  releasePlanText.includes(LATEST_EVIDENCE_CITATION_LOG),
  'release validation plan must cite the final current evidence-citation validation log'
);

const rolloutMigrationText = fs.readFileSync(
  path.join(root, 'docs', 'specs', 'usr-core-rollout-release-migration.md'),
  'utf8'
);
const rolloutPhaseRows = [
  ...rolloutMigrationText.matchAll(/^\| (Phase [A-H]) \| ([^|]+) \| ([^|]+) \|$/gm)
].map((match) => ({
  phase: match[1],
  lifecycle: match[2].trim()
}));
assert.equal(rolloutPhaseRows.length, 8, 'rollout migration policy must define Phase A-H rows');
for (const row of rolloutPhaseRows) {
  const escapedLifecycle = row.lifecycle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    roadmapText,
    new RegExp(`^\\| ${row.phase} \\| ${escapedLifecycle} \\|`, 'm'),
    `roadmap must anchor ${row.phase} rollout lifecycle`
  );
}

const assertTemplateIsPlaceholderOnly = (subdir) => {
  const templatePath = path.join(root, 'docs', 'specs', 'usr', subdir, 'TEMPLATE.md');
  const templateText = fs.readFileSync(templatePath, 'utf8');
  assert.match(
    templateText,
    /Template placeholder rows are not active checklist state\./,
    `${subdir} template must label checklist placeholders as non-active state`
  );
  assert.equal(
    /^- \[[ xX]\] /m.test(templateText),
    false,
    `${subdir} template must not contain active Markdown checkbox rows`
  );
};

assertTemplateIsPlaceholderOnly('languages');
assertTemplateIsPlaceholderOnly('frameworks');

const languageDocs = readDocs('languages');
assert.equal(languageDocs.length, languageProfiles.length, 'language docs must cover every language profile');

for (const doc of languageDocs) {
  checkboxState(doc.text, 'Owner-role review completed.');
  checkboxState(doc.text, 'Backup-owner review completed.');
  assertChecked(doc.text, 'Matrix linkage verified against language/version/embedding registries.');
  assertChecked(doc.text, 'Required fixture families assigned with concrete fixture IDs.');
  assertChecked(doc.text, 'Required conformance levels mapped to executable lanes.');

  const profile = languageProfileById.get(doc.id);
  assert.ok(profile, `missing language profile row for ${doc.id}`);
  assert.ok(languageVersionById.has(doc.id), `missing language version row for ${doc.id}`);
  assert.ok(languageEmbeddingById.has(doc.id), `missing language embedding row for ${doc.id}`);

  const docConformance = backtickValues(sectionText(doc.text, 'Required conformance levels'));
  assert.deepEqual(docConformance, profile.requiredConformance, `language conformance mismatch for ${doc.id}`);

  const shard = shardByLanguage.get(doc.id);
  assert.ok(shard, `missing executable shard mapping for ${doc.id}`);
  assertOrderManifestExists(shard);
  for (const level of profile.requiredConformance || []) {
    assert.ok(
      (shard.requiredConformance || []).includes(level),
      `language shard ${shard.id} for ${doc.id} missing ${level}`
    );
  }

  const fixtureIds = backtickValues(sectionText(doc.text, 'Required fixture ID mappings'));
  assert.ok(fixtureIds.length > 0, `language ${doc.id} must list concrete fixture IDs`);
  assertFixtureFamiliesCoverConformance({ profileType: 'language', profileId: doc.id, fixtureIds });
  for (const fixtureId of fixtureIds) {
    const fixture = fixtureById.get(fixtureId);
    assert.ok(fixture, `language ${doc.id} fixture missing governance row: ${fixtureId}`);
    assert.equal(fixture.profileType, 'language', `fixture ${fixtureId} must be language-scoped`);
    assert.equal(fixture.profileId, doc.id, `fixture ${fixtureId} must point at ${doc.id}`);
    assert.equal(fixture.blocking, true, `fixture ${fixtureId} must be blocking`);
  }
}

const frameworkDocs = readDocs('frameworks');
assert.equal(frameworkDocs.length, frameworkProfiles.length, 'framework docs must cover every framework profile');

const frameworkPolicyLane = sloBudgetByLane.get('lang-framework-canonicalization');
assert.ok(frameworkPolicyLane, 'framework C4 policy lane must have an SLO budget row');
assert.equal(frameworkPolicyLane.profileScope, 'framework', 'framework C4 policy lane must be framework-scoped');
assert.equal(frameworkPolicyLane.scopeId, 'C4', 'framework C4 policy lane must be scoped to C4');
assert.equal(frameworkPolicyLane.blocking, true, 'framework C4 policy lane must be blocking');
assert.ok(
  benchmarkPolicies.some((row) => row.laneId === 'lang-framework-canonicalization'
    && row.datasetClass === 'framework-overlay'
    && row.blocking === true),
  'framework C4 policy lane must have a blocking framework-overlay benchmark policy row'
);

for (const doc of frameworkDocs) {
  checkboxState(doc.text, 'Owner-role review completed.');
  checkboxState(doc.text, 'Backup-owner review completed.');
  assertChecked(doc.text, 'Matrix linkage verified against framework profile and edge-case registries.');
  assertChecked(doc.text, 'Required framework fixture families assigned with concrete fixture IDs.');
  assertChecked(doc.text, 'Required C4 conformance checks mapped to executable lanes.');

  const profile = frameworkProfileById.get(doc.id);
  assert.ok(profile, `missing framework profile row for ${doc.id}`);
  assert.ok((profile.requiredConformance || []).includes('C4'), `framework ${doc.id} must require C4`);

  const docEdgeCases = backtickValuesForKey(sectionText(doc.text, '8. Required fixtures and evidence'), 'edgeCaseCaseIds');
  assert.deepEqual(docEdgeCases, profile.edgeCaseCaseIds, `framework edge-case doc mismatch for ${doc.id}`);

  for (const edgeCaseId of profile.edgeCaseCaseIds || []) {
    const edgeCase = frameworkEdgeCaseById.get(edgeCaseId);
    assert.ok(edgeCase, `framework ${doc.id} edge case missing registry row: ${edgeCaseId}`);
    assert.equal(edgeCase.frameworkProfile, doc.id, `edge case ${edgeCaseId} must point at ${doc.id}`);
    assert.equal(edgeCase.blocking, true, `edge case ${edgeCaseId} must be blocking`);
  }

  const fixtureIds = backtickValues(sectionText(doc.text, '8. Required fixtures and evidence'))
    .filter((value) => value.includes('::'));
  assert.ok(fixtureIds.length > 0, `framework ${doc.id} must list concrete fixture IDs`);
  assertFixtureFamiliesCoverConformance({ profileType: 'framework', profileId: doc.id, fixtureIds });
  for (const fixtureId of fixtureIds) {
    const fixture = fixtureById.get(fixtureId);
    assert.ok(fixture, `framework ${doc.id} fixture missing governance row: ${fixtureId}`);
    assert.equal(fixture.profileType, 'framework', `fixture ${fixtureId} must be framework-scoped`);
    assert.equal(fixture.profileId, doc.id, `fixture ${fixtureId} must point at ${doc.id}`);
    assert.equal(fixture.blocking, true, `fixture ${fixtureId} must be blocking`);
    assert.ok((fixture.conformanceLevels || []).includes('C4'), `fixture ${fixtureId} must cover C4`);
  }

  for (const languageId of profile.appliesToLanguages || []) {
    const shard = shardByLanguage.get(languageId);
    assert.ok(shard, `framework ${doc.id} language ${languageId} missing executable shard`);
    assertOrderManifestExists(shard);
    assert.ok(
      (shard.requiredConformance || []).includes('C4'),
      `framework ${doc.id} language ${languageId} shard must include C4`
    );
  }
}

console.log('usr contract checklists test passed');

