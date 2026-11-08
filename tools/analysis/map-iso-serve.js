#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { MAP_REPORT_OPTIONS } from '../shared/operator-cli-options.js';
import { runMapPreview } from './map-iso-preview.js';
import { projectMapReadFailure } from '../../src/map/shared/read-outcome.js';

// Retained script compatibility; report map --serve is the canonical front door.
const argv = createCli({ scriptName: 'report map --serve', options: {
  ...MAP_REPORT_OPTIONS,
  dir: { type: 'string', describe: 'Alias for --repo.' },
  open: { type: 'boolean', default: true, describe: 'Open browser after listener readiness.' }
} }).parse();
try { await runMapPreview(argv); }
catch (error) { console.error(`Map preview failed: ${projectMapReadFailure(error).message}`); process.exitCode = 1; }
