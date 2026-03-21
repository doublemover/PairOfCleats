#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const supervisorSource = fs.readFileSync(supervisorPath, 'utf8');

if (!supervisorSource.includes('emitHello({ supervisorVersion, session: buildSessionDescriptor() });')) {
  console.error('startup handshake contract test failed: supervisor must emit startup hello');
  process.exit(1);
}

if (mainSource.includes('"op": "hello"')) {
  console.error('startup handshake contract test failed: TUI client should not send a redundant startup hello request');
  process.exit(1);
}

if (!mainSource.includes('"op": "flow:credit"')) {
  console.error('startup handshake contract test failed: TUI client should still pre-seed flow credits');
  process.exit(1);
}

console.log('tui startup handshake contract test passed');
