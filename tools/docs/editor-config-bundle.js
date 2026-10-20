#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = createCli({ scriptName: 'editor-config-bundle', options: { out: { type: 'string' } } })
  .strictOptions().parse();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'src/contracts/editor-config-contract.json'), 'utf8'));
const output = args.out || path.join(root, 'sublime/PairOfCleats/editor-config-contract.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(contract, null, 2)}\n`);
