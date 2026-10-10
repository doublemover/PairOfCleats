#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
const executeCli = promisify(execFile);
try {
  const specification = fixture.options();
  const destination = specification.destination; delete specification.destination;
  specification.inputs = specification.inputs.map(input => ({ ...input, path: path.basename(input.path) }));
  const specificationPath = path.join(fixture.root, 'specification.json');
  await fs.writeFile(specificationPath, JSON.stringify(specification));
  const tool = fileURLToPath(new URL('../../../tools/ingest/runtime-evidence.js', import.meta.url));
  const entrypoint = fileURLToPath(new URL('../../../bin/pairofcleats.js', import.meta.url));
  const result = await executeCli(process.execPath, [entrypoint, 'ingest', 'runtime-evidence', '--specification', specificationPath, '--out', destination], { timeout: 30000 });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.executionAuthorized, false); assert.equal(receipt.recordCount, 7);
  const previous = await fs.readFile(path.join(destination, 'current.json'));
  await fs.writeFile(specificationPath, JSON.stringify({ ...specification, command: 'not an import action' }));
  await assert.rejects(executeCli(process.execPath, [tool, '--specification', specificationPath, '--out', destination], { timeout: 30000 }),
    error => error.stderr.includes('Unknown runtime import specification fields'));
  assert.deepEqual(await fs.readFile(path.join(destination, 'current.json')), previous);
  console.log('explicit saved-artifact CLI imports offline and rejects execution specification fields');
} finally { await fixture.cleanup(); }
