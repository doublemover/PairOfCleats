#!/usr/bin/env node
import {
  ensureArray,
  finishGate,
  parseGateArgs,
  readConfig,
  readJsonFromRoot,
  repoPath,
  writeGateReport
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-35-framework-canonicalization.json');

const main = async () => {
  const argv = parseGateArgs();
  const config = await readConfig(CONFIG_PATH);

  const frameworkProfilesJson = await readJsonFromRoot(config.inputs.frameworkProfiles);
  const frameworkEdgeCasesJson = await readJsonFromRoot(config.inputs.frameworkEdgeCases);
  const frameworkFixtureJson = config.inputs.frameworkFixtureBundle
    ? await readJsonFromRoot(config.inputs.frameworkFixtureBundle)
    : { rows: [] };

  const frameworkRows = ensureArray(frameworkProfilesJson.rows);
  const edgeCaseRows = ensureArray(frameworkEdgeCasesJson.rows);
  const fixtureRows = ensureArray(frameworkFixtureJson.rows);

  const errors = [];
  const warnings = [];

  const profileById = new Map(frameworkRows.map((row) => [row.id, row]));
  const edgeCasesByFramework = new Map();
  const edgeCaseIdByFramework = new Map();
  const fixtureByFramework = new Map();
  for (const row of edgeCaseRows) {
    const frameworkId = row.frameworkProfile;
    if (!edgeCasesByFramework.has(frameworkId)) {
      edgeCasesByFramework.set(frameworkId, []);
      edgeCaseIdByFramework.set(frameworkId, new Set());
    }
    edgeCasesByFramework.get(frameworkId).push(row);
    edgeCaseIdByFramework.get(frameworkId).add(row.id);
  }
  for (const row of fixtureRows) {
    const frameworkId = row.frameworkProfile;
    if (!frameworkId || fixtureByFramework.has(frameworkId)) continue;
    fixtureByFramework.set(frameworkId, row);
  }

  const requiredFrameworks = ensureArray(config.requiredFrameworkProfiles);
  for (const frameworkId of requiredFrameworks) {
    if (!profileById.has(frameworkId)) {
      errors.push(`missing framework profile: ${frameworkId}`);
    }
    if (!edgeCasesByFramework.has(frameworkId)) {
      errors.push(`missing framework edge-case rows: ${frameworkId}`);
    }
    if (!fixtureByFramework.has(frameworkId)) {
      errors.push(`missing framework canonicalization fixture row: ${frameworkId}`);
    }
  }

  const categoryKinds = config.requiredCategoryKinds || {};
  const coverageByFramework = {};

  for (const frameworkId of requiredFrameworks) {
    const profile = profileById.get(frameworkId);
    if (!profile) continue;

    const edgeRows = edgeCasesByFramework.get(frameworkId) || [];
    const edgeCaseIds = edgeCaseIdByFramework.get(frameworkId) || new Set();
    const fixtureRow = fixtureByFramework.get(frameworkId) || {};
    const coveredEdgeCaseIds = new Set(ensureArray(fixtureRow.coveredEdgeCaseIds));
    const fixtureKinds = new Set(
      ensureArray(fixtureRow.edges)
        .map((edge) => String(edge?.kind || '').trim())
        .filter(Boolean)
    );
    const expectedEdgeCaseIds = ensureArray(profile.edgeCaseCaseIds);
    const coverage = {
      route: false,
      template: false,
      style: false,
      missingFixtureEdgeCaseIds: []
    };

    for (const edgeCaseId of expectedEdgeCaseIds) {
      if (!edgeCaseIds.has(edgeCaseId)) {
        errors.push(`framework profile ${frameworkId} references unknown edge-case id ${edgeCaseId}`);
      }
      if (!coveredEdgeCaseIds.has(edgeCaseId)) {
        coverage.missingFixtureEdgeCaseIds.push(edgeCaseId);
      }
    }

    for (const coveredEdgeCaseId of coveredEdgeCaseIds) {
      if (!edgeCaseIds.has(coveredEdgeCaseId)) {
        errors.push(
          `framework canonicalization fixture ${frameworkId} references unknown edge-case id ${coveredEdgeCaseId}`
        );
      }
    }

    for (const row of edgeRows) {
      const category = row.category;
      const requiredKind = categoryKinds[category];
      if (!requiredKind) continue;
      coverage[category] = true;
      const requiredEdgeKinds = ensureArray(row.requiredEdgeKinds);
      if (!requiredEdgeKinds.includes(requiredKind)) {
        errors.push(
          `framework edge-case ${row.id} (${frameworkId}) missing required kind ${requiredKind}`
        );
      }
    }

    const bindingKinds = ensureArray(profile.bindingSemantics?.requiredEdgeKinds);
    const requiresRoute = profile.routeSemantics?.enabled !== false;

    if (!bindingKinds.includes(categoryKinds.template)) {
      errors.push(`framework profile ${frameworkId} missing template canonical kind ${categoryKinds.template}`);
    }
    if (!bindingKinds.includes(categoryKinds.style)) {
      errors.push(`framework profile ${frameworkId} missing style canonical kind ${categoryKinds.style}`);
    }
    if (requiresRoute && !bindingKinds.includes(categoryKinds.route)) {
      errors.push(`framework profile ${frameworkId} missing route canonical kind ${categoryKinds.route}`);
    }

    const requiredCategories = requiresRoute
      ? ['route', 'template', 'style']
      : ['template', 'style'];

    for (const category of requiredCategories) {
      if (!coverage[category]) {
        errors.push(`framework ${frameworkId} missing ${category} edge-case coverage`);
      }
      const requiredKind = categoryKinds[category];
      if (requiredKind && !fixtureKinds.has(requiredKind)) {
        errors.push(
          `framework canonicalization fixture ${frameworkId} missing required edge kind ${requiredKind}`
        );
      }
    }

    if (coverage.missingFixtureEdgeCaseIds.length) {
      errors.push(
        `framework canonicalization fixture ${frameworkId} missing covered edge-case ids: `
        + coverage.missingFixtureEdgeCaseIds.join(', ')
      );
    }

    if ((edgeRows.length || 0) < 3) {
      warnings.push(`framework ${frameworkId} has low edge-case row count (${edgeRows.length})`);
    }

    coverageByFramework[frameworkId] = {
      edgeCaseCount: edgeRows.length,
      expectedEdgeCaseIds: expectedEdgeCaseIds.length,
      coveredEdgeCaseIds: coveredEdgeCaseIds.size,
      routeEnabled: requiresRoute,
      coverage
    };
  }

  const report = {
    section: config.section,
    item: config.item,
    title: config.title,
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    sources: config.inputs,
    metrics: {
      frameworkProfiles: frameworkRows.length,
      edgeCaseRows: edgeCaseRows.length,
      fixtureRows: fixtureRows.length,
      requiredFrameworks: requiredFrameworks.length
    },
    coverageByFramework,
    errors,
    warnings
  };

  await writeGateReport({ argv, config, report });
  finishGate({
    report,
    passedMessage: 'item 35 gate passed',
    failedMessage: 'item 35 gate failed',
    strict: argv.strict
  });
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
