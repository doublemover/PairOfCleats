#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const defaults = {
  dir: path.join(root, 'src', 'lang', 'lexicon', 'wordlists'),
  json: false
};

const parseArgs = (argv) => {
  const out = { ...defaults };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--dir') {
      out.dir = path.resolve(argv[i + 1] || out.dir);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node tools/lexicon/report.js [--json] [--dir <path>]');
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
};

const toStringArray = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);

const countUnion = (...lists) => {
  const set = new Set();
  for (const list of lists) {
    for (const item of list) {
      set.add(item);
    }
  }
  return set.size;
};

const main = async () => {
  const options = parseArgs(process.argv);
  const entries = await fs.readdir(options.dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const rows = [];
  for (const fileName of files) {
    const filePath = path.join(options.dir, fileName);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    const keywords = toStringArray(payload.keywords);
    const literals = toStringArray(payload.literals);
    const types = toStringArray(payload.types);
    const builtins = toStringArray(payload.builtins);
    const modules = toStringArray(payload.modules);

    rows.push({
      file: fileName,
      languageId: typeof payload.languageId === 'string' ? payload.languageId : path.basename(fileName, '.json'),
      formatVersion: Number.isFinite(Number(payload.formatVersion)) ? Number(payload.formatVersion) : null,
      counts: {
        keywords: keywords.length,
        literals: literals.length,
        types: types.length,
        builtins: builtins.length,
        modules: modules.length
      },
      derivedStopwords: {
        relations: countUnion(keywords, literals),
        ranking: countUnion(keywords, literals, types, builtins),
        chargrams: countUnion(keywords, literals)
      }
    });
  }

  const totals = rows.reduce((acc, row) => {
    acc.keywords += row.counts.keywords;
    acc.literals += row.counts.literals;
    acc.types += row.counts.types;
    acc.builtins += row.counts.builtins;
    acc.modules += row.counts.modules;
    return acc;
  }, {
    keywords: 0,
    literals: 0,
    types: 0,
    builtins: 0,
    modules: 0
  });

  const report = {
    generatedAt: new Date().toISOString(),
    directory: options.dir,
    wordlists: rows,
    totals,
    versioning: {
      wordlistFormatVersion: 1,
      explainPayloadVersion: 1,
      nonAsciiSupport: 'deferred-v2'
    }
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`[lexicon:report] generatedAt=${report.generatedAt}`);
  console.log(`[lexicon:report] wordlists=${rows.length} keywords=${totals.keywords} literals=${totals.literals}`);
  for (const row of rows) {
    console.log(
      `- ${row.languageId}: keywords=${row.counts.keywords} literals=${row.counts.literals} ` +
      `relationsStopwords=${row.derivedStopwords.relations}`
    );
  }
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
