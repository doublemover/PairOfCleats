#!/usr/bin/env node
import crypto from 'node:crypto';
import {
  ensureArray,
  parseBenchArgs,
  readJsonFileWithRaw,
  readJsonFromRoot,
  repoPath,
  writeBenchJson
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-39-normalization-linking-identity.json');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const hashInputs = (inputs) => {
  const h = crypto.createHash('sha256');
  for (const value of inputs) {
    h.update(String(value));
    h.update('\0');
  }
  return h.digest('hex');
};

const main = async () => {
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);

  const nodeMapping = await readJsonFromRoot(config.inputs.nodeKindMapping);
  const edgeConstraints = await readJsonFromRoot(config.inputs.edgeKindConstraints);

  const nodeRows = ensureArray(nodeMapping.json.rows);
  const edgeRows = ensureArray(edgeConstraints.json.rows);

  const normalizedKinds = new Set(
    nodeRows
      .filter((row) => isRecord(row))
      .map((row) => row.normalizedKind)
      .filter((kind) => typeof kind === 'string' && kind.trim() !== '')
  );
  const edgeKinds = new Set(
    edgeRows
      .filter((row) => isRecord(row))
      .map((row) => row.edgeKind)
      .filter((kind) => typeof kind === 'string' && kind.trim() !== '')
  );

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      nodeKindMappings: nodeRows.length,
      normalizedKinds: normalizedKinds.size,
      edgeKindConstraints: edgeRows.length,
      uniqueEdgeKinds: edgeKinds.size
    },
    sourceDigest: hashInputs([configRaw, nodeMapping.raw, edgeConstraints.raw])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item39 mappings=${report.metrics.nodeKindMappings} `
      + `normKinds=${report.metrics.normalizedKinds} edgeKinds=${report.metrics.uniqueEdgeKinds}`
    );
    console.log(JSON.stringify(report, null, 2));
  }

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
