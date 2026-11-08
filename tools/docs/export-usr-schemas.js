#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { USR_EVIDENCE_ENVELOPE_SCHEMA, USR_SCHEMA_DEFS } from '../../src/contracts/schemas/usr.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';

export const buildUsrDocumentSchemas = () => new Map([
  ['evidence-envelope.schema.json', { ...USR_EVIDENCE_ENVELOPE_SCHEMA, $id: 'usr/evidence-envelope.schema.json' }],
  ...Object.entries(USR_SCHEMA_DEFS).map(([id, schema]) => [`${id}.schema.json`, {
    ...schema, $id: `usr/${id}.schema.json`
  }])
]);

export const exportUsrSchemas = async (outDir) => {
  await fs.mkdir(outDir, { recursive: true });
  for (const [name, schema] of buildUsrDocumentSchemas()) {
    await fs.writeFile(path.join(outDir, name), `${JSON.stringify(schema, null, 2)}\n`);
  }
};

if (isDirectExecution(import.meta.url)) {
  const offset = process.argv.indexOf('--out-dir');
  await exportUsrSchemas(path.resolve(offset >= 0 ? process.argv[offset + 1] : 'docs/schemas/usr'));
}
