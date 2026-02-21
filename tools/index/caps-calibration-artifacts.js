#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCapsCalibrationArtifacts } from '../../src/index/build/runtime/caps-calibration.js';

const root = process.cwd();
const outDir = path.join(root, 'docs', 'config');
const benchDir = path.join(root, 'benchmarks', 'index');

const writeJson = async (targetPath, value) => {
  const payload = JSON.stringify(value, null, 2) + '\n';
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, payload, 'utf8');
};

const artifacts = buildCapsCalibrationArtifacts();

await writeJson(
  path.join(outDir, 'caps-calibration-inputs.json'),
  {
    schemaVersion: artifacts.schemaVersion,
    generatedAt: artifacts.generatedAt,
    source: artifacts.inputs.source,
    languages: artifacts.inputs.languages
  }
);

await writeJson(
  path.join(outDir, 'caps-calibration-results.json'),
  {
    schemaVersion: artifacts.schemaVersion,
    generatedAt: artifacts.generatedAt,
    fileCapsByLanguage: artifacts.results.fileCapsByLanguage,
    treeSitterByLanguage: artifacts.results.treeSitterByLanguage
  }
);

await writeJson(
  path.join(benchDir, 'caps-calibration-inputs.json'),
  {
    schemaVersion: artifacts.schemaVersion,
    generatedAt: artifacts.generatedAt,
    source: artifacts.inputs.source,
    languages: artifacts.inputs.languages
  }
);

await writeJson(
  path.join(benchDir, 'caps-calibration-results.json'),
  {
    schemaVersion: artifacts.schemaVersion,
    generatedAt: artifacts.generatedAt,
    fileCapsByLanguage: artifacts.results.fileCapsByLanguage,
    treeSitterByLanguage: artifacts.results.treeSitterByLanguage
  }
);

console.log('caps calibration artifacts generated');
