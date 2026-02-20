#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-39-normalization-linking-identity.json');

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
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toLabel = (value) => (typeof value === 'string' && value.trim() ? value : '<unknown>');

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  const nodeKindMappingJson = await readJson(config.inputs.nodeKindMapping);
  const edgeKindConstraintsJson = await readJson(config.inputs.edgeKindConstraints);

  const nodeRows = ensureArray(nodeKindMappingJson.rows);
  const edgeRows = ensureArray(edgeKindConstraintsJson.rows);

  const errors = [];
  const warnings = [];

  const mappingKeys = new Set();
  for (const [index, row] of nodeRows.entries()) {
    if (!isRecord(row)) {
      errors.push(`node kind mapping row ${index} must be an object`);
      continue;
    }

    const requiredFields = [
      'languageId',
      'parserSource',
      'rawKind',
      'normalizedKind',
      'category',
      'confidence',
      'priority',
      'provenance'
    ];

    for (const field of requiredFields) {
      if (!(field in row)) {
        errors.push(`node kind mapping row missing ${field}`);
      }
    }

    const mappingLabel = `${toLabel(row.rawKind)} (${toLabel(row.languageId)})`;
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(`invalid confidence for node kind mapping ${mappingLabel}`);
    }

    const priority = Number(row.priority);
    if (!Number.isInteger(priority)) {
      errors.push(`invalid priority for node kind mapping ${mappingLabel}`);
    }

    if (typeof row.normalizedKind !== 'string' || row.normalizedKind.trim() === '') {
      errors.push(`empty normalizedKind for node kind mapping ${mappingLabel}`);
    }

    const key = `${toLabel(row.languageId)}|${toLabel(row.parserSource)}|${toLabel(row.rawKind)}`;
    if (mappingKeys.has(key)) {
      warnings.push(`duplicate node kind mapping key ${key}`);
    }
    mappingKeys.add(key);
  }

  const allowedEntityKinds = new Set(ensureArray(config.allowedEntityKinds));
  const edgeKindSet = new Set();
  const edgeByKind = new Map();

  for (const [index, row] of edgeRows.entries()) {
    if (!isRecord(row)) {
      errors.push(`edge kind constraint row ${index} must be an object`);
      continue;
    }

    const requiredFields = [
      'edgeKind',
      'sourceEntityKinds',
      'targetEntityKinds',
      'requiredAttrs',
      'optionalAttrs',
      'blocking'
    ];

    for (const field of requiredFields) {
      if (!(field in row)) {
        errors.push(`edge kind constraint row missing ${field}`);
      }
    }

    const edgeKind = typeof row.edgeKind === 'string' ? row.edgeKind.trim() : '';
    if (!edgeKind) {
      errors.push(`edge kind constraint row ${index} has invalid edgeKind`);
      continue;
    }

    if (edgeKindSet.has(edgeKind)) {
      errors.push(`duplicate edge kind constraint: ${edgeKind}`);
    }
    edgeKindSet.add(edgeKind);
    edgeByKind.set(edgeKind, row);

    if (!Array.isArray(row.sourceEntityKinds)) {
      errors.push(`edge kind ${edgeKind} has invalid sourceEntityKinds (expected array)`);
    }
    if (!Array.isArray(row.targetEntityKinds)) {
      errors.push(`edge kind ${edgeKind} has invalid targetEntityKinds (expected array)`);
    }
    if (!Array.isArray(row.requiredAttrs)) {
      errors.push(`edge kind ${edgeKind} has invalid requiredAttrs (expected array)`);
    }
    if (!Array.isArray(row.optionalAttrs)) {
      errors.push(`edge kind ${edgeKind} has invalid optionalAttrs (expected array)`);
    }
    if (typeof row.blocking !== 'boolean') {
      errors.push(`edge kind ${edgeKind} has invalid blocking flag (expected boolean)`);
    }

    for (const entityKind of ensureArray(row.sourceEntityKinds)) {
      if (!allowedEntityKinds.has(entityKind)) {
        errors.push(`edge kind ${edgeKind} has invalid source entity kind ${entityKind}`);
      }
    }

    for (const entityKind of ensureArray(row.targetEntityKinds)) {
      if (!allowedEntityKinds.has(entityKind)) {
        errors.push(`edge kind ${edgeKind} has invalid target entity kind ${entityKind}`);
      }
    }
  }

  for (const requiredEdgeKind of ensureArray(config.requiredEdgeKinds)) {
    if (typeof requiredEdgeKind !== 'string' || requiredEdgeKind.trim() === '') {
      errors.push('config.requiredEdgeKinds contains an invalid edge kind');
      continue;
    }
    if (!edgeByKind.has(requiredEdgeKind)) {
      errors.push(`missing required edge kind constraint ${requiredEdgeKind}`);
    }
  }

  const defaultRequiredAttrsByEdge = {
    route_maps_to: 'routePattern',
    template_binds: 'bindingKind',
    style_scopes: 'scopeKind',
    hydration_boundary: 'runtimeSide'
  };
  const configuredRequiredAttrsByEdge = isRecord(config.requiredAttrsByEdge)
    ? config.requiredAttrsByEdge
    : defaultRequiredAttrsByEdge;

  for (const [edgeKind, requiredAttrs] of Object.entries(configuredRequiredAttrsByEdge)) {
    const requiredAttrList = Array.isArray(requiredAttrs) ? requiredAttrs : [requiredAttrs];
    if (requiredAttrList.length === 0) {
      errors.push(`config.requiredAttrsByEdge.${edgeKind} must include at least one required attr`);
      continue;
    }

    const row = edgeByKind.get(edgeKind);
    if (!row) continue;

    for (const requiredAttr of requiredAttrList) {
      if (typeof requiredAttr !== 'string' || requiredAttr.trim() === '') {
        errors.push(`config.requiredAttrsByEdge.${edgeKind} includes an invalid attr name`);
        continue;
      }
      if (!ensureArray(row.requiredAttrs).includes(requiredAttr)) {
        errors.push(`edge kind ${edgeKind} missing required attr ${requiredAttr}`);
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
      nodeKindMappings: nodeRows.length,
      edgeKindConstraints: edgeRows.length,
      requiredEdgeKinds: ensureArray(config.requiredEdgeKinds).length
    },
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 39 gate passed');
    return;
  }

  console.error('item 39 gate failed');
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
