#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skip } from '../../helpers/skip.js';

if (process.env.REDO_TARGET_HELPER !== '1') {
  skip('redo target is helper-only');
}

const markerPath = process.env.REDO_TARGET_MARKER
  || path.join(os.tmpdir(), `poc-redo-target-${process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX || 'default'}.marker`);

if (!fs.existsSync(markerPath)) {
  fs.writeFileSync(markerPath, 'redo');
  process.exit(3221225477);
}

fs.rmSync(markerPath, { force: true });
console.log('redo target ok');
