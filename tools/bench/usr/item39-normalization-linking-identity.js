#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-39-normalization-linking-identity.json');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { json: '', quiet: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      out.json = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
    }
  }
  return out;
};

const readJson = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return { json: JSON.parse(raw), raw };
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);
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
  const argv = parseArgs();
  const configRaw = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configRaw);

  const nodeMapping = await readJson(config.inputs.nodeKindMapping);
  const edgeConstraints = await readJson(config.inputs.edgeKindConstraints);

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

  if (argv.json) {
    const outPath = path.resolve(argv.json);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
