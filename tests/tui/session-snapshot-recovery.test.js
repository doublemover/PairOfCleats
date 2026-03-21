#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('fn resolve_snapshot_path()')) {
  console.error('session snapshot recovery test failed: missing snapshot path resolver');
  process.exit(1);
}
if (!source.includes('fn load_snapshot(') || !source.includes('fn save_snapshot(')) {
  console.error('session snapshot recovery test failed: missing snapshot load/save implementation');
  process.exit(1);
}
if (!source.includes('last-state.json')) {
  console.error('session snapshot recovery test failed: missing canonical last-state.json snapshot target');
  process.exit(1);
}
if (!source.includes('PAIROFCLEATS_TUI_INSTALL_ROOT') || !source.includes('PAIROFCLEATS_CACHE_ROOT')) {
  console.error('session snapshot recovery test failed: snapshot path should derive from install/cache root inputs');
  process.exit(1);
}
if (source.includes('Path::new(".cache").join("tui").join("last-state.json")')) {
  console.error('session snapshot recovery test failed: snapshot path should not default to repo-local .cache');
  process.exit(1);
}

console.log('tui session snapshot recovery test passed');
