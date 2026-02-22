#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { buildArtifactSchemaIndex } from '../../src/shared/artifact-schema-index.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats artifact-schema-index',
  options: {
    root: { type: 'string' },
    out: { type: 'string', default: 'docs/contracts/artifact-schema-index.json' }
  }
})
  .strictOptions()
  .parse();

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
