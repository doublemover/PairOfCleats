#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { importRuntimeEvidence } from '../../src/index/semantic/runtime/import.js';

const argv = createCli({ scriptName: 'runtime-evidence-import', options: {
  specification: { type: 'string', demandOption: true }, out: { type: 'string', demandOption: true }
} }).strictOptions().parse();
const specificationPath = path.resolve(argv.specification);
if ((await fs.stat(specificationPath)).size > 16 * 1024 * 1024) throw new Error('Runtime import specification exceeds allowance.');
const specification = JSON.parse(await fs.readFile(specificationPath, 'utf8'));
if (Object.keys(specification).some(key => !['capture', 'authority', 'inputs', 'sourceCandidates', 'importOptions'].includes(key))) throw new Error('Unknown runtime import specification fields.');
const result = await importRuntimeEvidence({ ...specification, destination: path.resolve(argv.out),
  inputs: specification.inputs.map(input => ({ ...input, path: path.resolve(path.dirname(specificationPath), input.path) })) });
process.stdout.write(JSON.stringify({ executionAuthorized: false, generationId: result.pointer.generationId,
  recordCount: result.recordCount, coverage: result.coverage }) + '\n');
