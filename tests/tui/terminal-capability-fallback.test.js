#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

const requiredTokens = [
  'NO_COLOR',
  'PAIROFCLEATS_TUI_UNICODE',
  'PAIROFCLEATS_TUI_MOUSE',
  'PAIROFCLEATS_TUI_ALT_SCREEN',
  'EnableMouseCapture',
  'DisableMouseCapture',
  'EnterAlternateScreen',
  'LeaveAlternateScreen'
];
for (const token of requiredTokens) {
  if (!source.includes(token)) {
    console.error(`terminal capability fallback test failed: missing ${token}`);
    process.exit(1);
  }
}

console.log('tui terminal capability fallback test passed');
