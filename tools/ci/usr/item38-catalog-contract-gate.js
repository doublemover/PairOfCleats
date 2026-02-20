#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-38-catalog-contract.json');

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
const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asId = (value) => (typeof value === 'string' ? value.trim() : '');
const stableJson = (value) => JSON.stringify(value);
const normalizeVersionPolicy = (value) => ({
  minVersion: value?.minVersion ?? null,
  maxVersion: value?.maxVersion ?? null,
  dialects: ensureArray(value?.dialects),
  featureFlags: ensureArray(value?.featureFlags)
});
const normalizeEmbeddingPolicy = (value) => ({
  canHostEmbedded: value?.canHostEmbedded ?? null,
  canBeEmbedded: value?.canBeEmbedded ?? null,
  embeddedLanguageAllowlist: ensureArray(value?.embeddedLanguageAllowlist)
});

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  const languageProfilesJson = await readJson(config.inputs.languageProfiles);
  const frameworkProfilesJson = await readJson(config.inputs.frameworkProfiles);
  const edgeCasesJson = await readJson(config.inputs.frameworkEdgeCases);
  const capabilityJson = await readJson(config.inputs.capabilityMatrix);
  const versionJson = await readJson(config.inputs.languageVersionPolicy);
  const embeddingJson = await readJson(config.inputs.languageEmbeddingPolicy);

  const languageRows = ensureArray(languageProfilesJson.rows);
  const frameworkRows = ensureArray(frameworkProfilesJson.rows);
  const edgeCaseRows = ensureArray(edgeCasesJson.rows);
  const capabilityRows = ensureArray(capabilityJson.rows);
  const versionRows = ensureArray(versionJson.rows);
  const embeddingRows = ensureArray(embeddingJson.rows);

  const errors = [];
  const warnings = [];

  const requiredLanguageKeys = ensureArray(config.requiredLanguageKeys);
  const requiredFrameworkKeys = ensureArray(config.requiredFrameworkKeys);

  const languageIds = new Set();
  const languageById = new Map();
  for (const [index, row] of languageRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`language profile row ${index} is not an object`);
      continue;
    }

    const languageId = asId(row.id);
    const languageLabel = languageId || `<row ${index}>`;
    for (const key of requiredLanguageKeys) {
      if (!(key in row)) {
        errors.push(`language profile ${languageLabel} missing key ${key}`);
      }
    }

    if (!languageId) {
      errors.push(`language profile row ${index} missing valid string id`);
      continue;
    }
    if (languageIds.has(languageId)) {
      errors.push(`duplicate language profile id: ${languageId}`);
      continue;
    }

    languageIds.add(languageId);
    languageById.set(languageId, row);
  }

  const frameworkIds = new Set();
  const frameworkById = new Map();
  for (const [index, row] of frameworkRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`framework profile row ${index} is not an object`);
      continue;
    }

    const frameworkId = asId(row.id);
    const frameworkLabel = frameworkId || `<row ${index}>`;
    for (const key of requiredFrameworkKeys) {
      if (!(key in row)) {
        errors.push(`framework profile ${frameworkLabel} missing key ${key}`);
      }
    }

    if (!frameworkId) {
      errors.push(`framework profile row ${index} missing valid string id`);
      continue;
    }
    if (frameworkIds.has(frameworkId)) {
      errors.push(`duplicate framework profile id: ${frameworkId}`);
      continue;
    }

    frameworkIds.add(frameworkId);
    frameworkById.set(frameworkId, row);
  }

  for (const frameworkId of ensureArray(config.requiredFrameworkProfiles)) {
    if (!frameworkIds.has(frameworkId)) {
      errors.push(`missing required framework profile: ${frameworkId}`);
    }
  }

  const edgeCaseIds = new Set();
  for (const [index, row] of edgeCaseRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`framework edge-case row ${index} is not an object`);
      continue;
    }

    const edgeCaseId = asId(row.id);
    if (!edgeCaseId) {
      errors.push(`framework edge-case row ${index} missing valid string id`);
      continue;
    }
    if (edgeCaseIds.has(edgeCaseId)) {
      errors.push(`duplicate framework edge-case id: ${edgeCaseId}`);
      continue;
    }
    edgeCaseIds.add(edgeCaseId);

    const frameworkProfileId = asId(row.frameworkProfile);
    if (!frameworkProfileId || !frameworkIds.has(frameworkProfileId)) {
      errors.push(`framework edge-case ${edgeCaseId} references unknown profile ${row.frameworkProfile}`);
    }
  }

  for (const [frameworkId, row] of frameworkById.entries()) {
    const appliesToLanguages = ensureArray(row.appliesToLanguages);
    if (appliesToLanguages.length === 0) {
      errors.push(`framework profile ${frameworkId} has empty appliesToLanguages`);
    }
    for (const languageIdValue of appliesToLanguages) {
      const languageId = asId(languageIdValue);
      if (!languageId || !languageIds.has(languageId)) {
        errors.push(`framework profile ${frameworkId} references unknown appliesToLanguage ${languageIdValue}`);
      }
    }

    const edgeCaseCaseIds = ensureArray(row.edgeCaseCaseIds);
    if (edgeCaseCaseIds.length === 0) {
      errors.push(`framework profile ${frameworkId} has empty edgeCaseCaseIds`);
    }
    for (const edgeCaseId of edgeCaseCaseIds) {
      if (!edgeCaseIds.has(edgeCaseId)) {
        errors.push(`framework profile ${frameworkId} references unknown edge-case ${edgeCaseId}`);
      }
    }

    const requiredEdgeKinds = ensureArray(row.bindingSemantics?.requiredEdgeKinds);
    if (!requiredEdgeKinds.includes('template_binds')) {
      errors.push(`framework profile ${frameworkId} missing template_binds in bindingSemantics.requiredEdgeKinds`);
    }
    if (!requiredEdgeKinds.includes('style_scopes')) {
      errors.push(`framework profile ${frameworkId} missing style_scopes in bindingSemantics.requiredEdgeKinds`);
    }
    if (row.routeSemantics?.enabled !== false && !requiredEdgeKinds.includes('route_maps_to')) {
      errors.push(`framework profile ${frameworkId} missing route_maps_to while routeSemantics.enabled is true`);
    }
  }

  const frameworkUsage = new Map();
  for (const [index, row] of languageRows.entries()) {
    if (!isObjectRecord(row)) {
      continue;
    }

    const languageId = asId(row.id) || `<row ${index}>`;
    const frameworkProfiles = ensureArray(row.frameworkProfiles);
    for (const frameworkIdValue of frameworkProfiles) {
      const frameworkId = asId(frameworkIdValue);
      if (!frameworkIds.has(frameworkId)) {
        errors.push(`language profile ${languageId} references unknown framework ${frameworkIdValue}`);
        continue;
      }
      frameworkUsage.set(frameworkId, (frameworkUsage.get(frameworkId) || 0) + 1);
    }
  }

  for (const frameworkId of frameworkIds) {
    if (!frameworkUsage.has(frameworkId)) {
      warnings.push(`framework profile ${frameworkId} is not referenced by any language profile`);
    }
  }

  const versionLanguageIds = new Set();
  const embeddingLanguageIds = new Set();
  const capabilityLanguageIds = new Set();
  const versionByLanguage = new Map();
  const embeddingByLanguage = new Map();

  for (const [index, row] of versionRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`version policy row ${index} is not an object`);
      continue;
    }

    const languageId = asId(row.languageId);
    if (!languageId) {
      errors.push(`version policy row ${index} missing languageId`);
      continue;
    }
    if (versionLanguageIds.has(languageId)) {
      errors.push(`duplicate version policy row for language ${languageId}`);
      continue;
    }

    versionLanguageIds.add(languageId);
    versionByLanguage.set(languageId, row);
    if (!languageIds.has(languageId)) {
      errors.push(`version policy references unknown language ${languageId}`);
    }
  }

  for (const [index, row] of embeddingRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`embedding policy row ${index} is not an object`);
      continue;
    }

    const languageId = asId(row.languageId);
    if (!languageId) {
      errors.push(`embedding policy row ${index} missing languageId`);
      continue;
    }
    if (embeddingLanguageIds.has(languageId)) {
      errors.push(`duplicate embedding policy row for language ${languageId}`);
      continue;
    }

    embeddingLanguageIds.add(languageId);
    embeddingByLanguage.set(languageId, row);
    if (!languageIds.has(languageId)) {
      errors.push(`embedding policy references unknown language ${languageId}`);
    }
  }

  for (const [index, row] of capabilityRows.entries()) {
    if (!isObjectRecord(row)) {
      errors.push(`capability matrix row ${index} is not an object`);
      continue;
    }

    const languageId = asId(row.languageId);
    if (!languageId) {
      errors.push(`capability matrix row ${index} missing languageId`);
      continue;
    }

    capabilityLanguageIds.add(languageId);
    if (!languageIds.has(languageId)) {
      errors.push(`capability matrix references unknown language ${languageId}`);
    }
  }

  for (const [languageId, languageRow] of languageById.entries()) {
    if (!versionLanguageIds.has(languageId)) {
      errors.push(`language profile ${languageId} missing version policy row`);
    }
    if (!embeddingLanguageIds.has(languageId)) {
      errors.push(`language profile ${languageId} missing embedding policy row`);
    }
    if (!capabilityLanguageIds.has(languageId)) {
      errors.push(`language profile ${languageId} missing capability matrix rows`);
    }

    const versionRow = versionByLanguage.get(languageId);
    if (versionRow) {
      const profileVersionPolicy = normalizeVersionPolicy(languageRow.languageVersionPolicy);
      const externalVersionPolicy = normalizeVersionPolicy(versionRow);
      if (stableJson(profileVersionPolicy) !== stableJson(externalVersionPolicy)) {
        errors.push(`language profile ${languageId} languageVersionPolicy does not match version policy row`);
      }
    }

    const embeddingRow = embeddingByLanguage.get(languageId);
    if (embeddingRow) {
      const profileEmbeddingPolicy = normalizeEmbeddingPolicy(languageRow.embeddingPolicy);
      const externalEmbeddingPolicy = normalizeEmbeddingPolicy(embeddingRow);
      if (stableJson(profileEmbeddingPolicy) !== stableJson(externalEmbeddingPolicy)) {
        errors.push(`language profile ${languageId} embeddingPolicy does not match embedding policy row`);
      }
    }
  }

  const report = {
    section: config.section,
    item: config.item,
    title: config.title,
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    sources: config.inputs,
    metrics: {
      languages: languageRows.length,
      frameworks: frameworkRows.length,
      edgeCases: edgeCaseRows.length,
      capabilityRows: capabilityRows.length,
      versionRows: versionRows.length,
      embeddingRows: embeddingRows.length
    },
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 38 gate passed');
    return;
  }

  console.error('item 38 gate failed');
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
