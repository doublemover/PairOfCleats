#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-35-framework-canonicalization.json');

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

const hashInputs = (inputs) => {
  const h = crypto.createHash('sha256');
  for (const value of inputs) {
    h.update(value);
  }
  return h.digest('hex');
};

const main = async () => {
  const argv = parseArgs();
  const configRaw = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configRaw);

  const frameworkProfiles = await readJson(config.inputs.frameworkProfiles);
  const frameworkEdgeCases = await readJson(config.inputs.frameworkEdgeCases);

  const profileRows = ensureArray(frameworkProfiles.json.rows);
  const edgeRows = ensureArray(frameworkEdgeCases.json.rows);

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

  let fullyCovered = 0;
  for (const frameworkId of config.requiredFrameworkProfiles) {
    const stats = perFramework.get(frameworkId) || { route: 0, template: 0, style: 0 };
    const hasRouteOrNotRequired = true;
    if (stats.template > 0 && stats.style > 0 && hasRouteOrNotRequired) {
      fullyCovered += 1;
    }
  }

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      frameworkProfiles: profileRows.length,
      edgeCaseRows: edgeRows.length,
      requiredFrameworks: config.requiredFrameworkProfiles.length,
      frameworksWithTemplateAndStyleCoverage: fullyCovered
    },
    sourceDigest: hashInputs([configRaw, frameworkProfiles.raw, frameworkEdgeCases.raw])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item35 frameworks=${report.metrics.frameworkProfiles} `
      + `edgeCases=${report.metrics.edgeCaseRows} covered=${report.metrics.frameworksWithTemplateAndStyleCoverage}`
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
