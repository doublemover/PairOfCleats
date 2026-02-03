#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { buildArtifactSchemaIndex } from '../src/shared/artifact-schema-index.js';

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats artifact-schema-index')
    .option('root', { type: 'string' })
    .option('out', { type: 'string', default: 'docs/contracts/artifact-schema-index.json' })
    .help()
    .alias('h', 'help')
    .strictOptions();
  return parser.parse();
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || process.cwd());
  const outPath = path.resolve(root, argv.out);
  const index = buildArtifactSchemaIndex();

  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`);
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
