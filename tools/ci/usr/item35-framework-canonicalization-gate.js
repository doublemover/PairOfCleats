#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-35-framework-canonicalization.json');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { out: '', strict: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out') {
      out.out = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--no-strict') {
      out.strict = false;
    }
  }
  return out;
};

const readJson = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  const frameworkProfilesJson = await readJson(config.inputs.frameworkProfiles);
  const frameworkEdgeCasesJson = await readJson(config.inputs.frameworkEdgeCases);

  const frameworkRows = ensureArray(frameworkProfilesJson.rows);
  const edgeCaseRows = ensureArray(frameworkEdgeCasesJson.rows);

  const errors = [];
  const warnings = [];

  const profileById = new Map(frameworkRows.map((row) => [row.id, row]));
  const edgeCasesByFramework = new Map();
  for (const row of edgeCaseRows) {
    const frameworkId = row.frameworkProfile;
    if (!edgeCasesByFramework.has(frameworkId)) {
      edgeCasesByFramework.set(frameworkId, []);
    }
    edgeCasesByFramework.get(frameworkId).push(row);
  }

  const requiredFrameworks = ensureArray(config.requiredFrameworkProfiles);
  for (const frameworkId of requiredFrameworks) {
    if (!profileById.has(frameworkId)) {
      errors.push(`missing framework profile: ${frameworkId}`);
    }
    if (!edgeCasesByFramework.has(frameworkId)) {
      errors.push(`missing framework edge-case rows: ${frameworkId}`);
    }
  }

  const categoryKinds = config.requiredCategoryKinds || {};
  const coverageByFramework = {};

  for (const frameworkId of requiredFrameworks) {
    const profile = profileById.get(frameworkId);
    if (!profile) continue;

    const edgeRows = edgeCasesByFramework.get(frameworkId) || [];
    const coverage = {
      route: false,
      template: false,
      style: false
    };

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
    }

    if ((edgeRows.length || 0) < 3) {
      warnings.push(`framework ${frameworkId} has low edge-case row count (${edgeRows.length})`);
    }

    coverageByFramework[frameworkId] = {
      edgeCaseCount: edgeRows.length,
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
      requiredFrameworks: requiredFrameworks.length
    },
    coverageByFramework,
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 35 gate passed');
    return;
  }

  console.error('item 35 gate failed');
  for (const error of errors) {
    console.error(`- ${error}`);
  }

  if (argv.strict) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
