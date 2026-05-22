#!/usr/bin/env node
import {
  ensureArray,
  hashInputs,
  parseBenchArgs,
  readJsonFileWithRaw,
  readJsonFromRoot,
  repoPath,
  writeBenchJson
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-35-framework-canonicalization.json');

const main = async () => {
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);

  const frameworkProfiles = await readJsonFromRoot(config.inputs.frameworkProfiles);
  const frameworkEdgeCases = await readJsonFromRoot(config.inputs.frameworkEdgeCases);
  const frameworkFixture = config.inputs.frameworkFixtureBundle
    ? await readJsonFromRoot(config.inputs.frameworkFixtureBundle)
    : { json: { rows: [] }, raw: '' };

  const profileRows = ensureArray(frameworkProfiles.json.rows);
  const edgeRows = ensureArray(frameworkEdgeCases.json.rows);
  const fixtureRows = ensureArray(frameworkFixture.json.rows);

  const perFramework = new Map();
  for (const row of edgeRows) {
    const frameworkId = row.frameworkProfile;
    if (!perFramework.has(frameworkId)) {
      perFramework.set(frameworkId, { total: 0, route: 0, template: 0, style: 0 });
    }
    const stats = perFramework.get(frameworkId);
    stats.total += 1;
    if (row.category === 'route') stats.route += 1;
    if (row.category === 'template') stats.template += 1;
    if (row.category === 'style') stats.style += 1;
  }

  const fixtureCoverageByFramework = new Map();
  for (const row of fixtureRows) {
    const frameworkId = String(row?.frameworkProfile || '').trim();
    if (!frameworkId || fixtureCoverageByFramework.has(frameworkId)) continue;
    fixtureCoverageByFramework.set(frameworkId, new Set(ensureArray(row?.coveredEdgeCaseIds)));
  }

  let fullyCovered = 0;
  let fixtureFullyCovered = 0;
  const fixtureCoverage = {};
  for (const frameworkId of config.requiredFrameworkProfiles) {
    const stats = perFramework.get(frameworkId) || { route: 0, template: 0, style: 0 };
    const hasRouteOrNotRequired = true;
    if (stats.template > 0 && stats.style > 0 && hasRouteOrNotRequired) {
      fullyCovered += 1;
    }
    const profile = profileRows.find((row) => row.id === frameworkId) || {};
    const expectedIds = ensureArray(profile.edgeCaseCaseIds);
    const coveredIds = fixtureCoverageByFramework.get(frameworkId) || new Set();
    const missingIds = expectedIds.filter((id) => !coveredIds.has(id));
    if (expectedIds.length > 0 && missingIds.length === 0) {
      fixtureFullyCovered += 1;
    }
    fixtureCoverage[frameworkId] = {
      expectedEdgeCaseIds: expectedIds.length,
      coveredEdgeCaseIds: coveredIds.size,
      missingEdgeCaseIds: missingIds.length
    };
  }

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      frameworkProfiles: profileRows.length,
      edgeCaseRows: edgeRows.length,
      fixtureRows: fixtureRows.length,
      requiredFrameworks: config.requiredFrameworkProfiles.length,
      frameworksWithTemplateAndStyleCoverage: fullyCovered,
      frameworksWithCompleteFixtureEdgeCaseCoverage: fixtureFullyCovered
    },
    fixtureCoverageByFramework: fixtureCoverage,
    sourceDigest: hashInputs([
      configRaw,
      frameworkProfiles.raw,
      frameworkEdgeCases.raw,
      frameworkFixture.raw
    ])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item35 frameworks=${report.metrics.frameworkProfiles} `
      + `edgeCases=${report.metrics.edgeCaseRows} covered=${report.metrics.frameworksWithTemplateAndStyleCoverage}`
    );
    console.log(JSON.stringify(report, null, 2));
  }

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
