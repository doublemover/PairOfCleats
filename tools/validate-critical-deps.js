#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const bundleDir = path.join(root, 'docs', 'references', 'dependency-bundle');
const criticalPath = path.join(bundleDir, 'critical-deps.json');
const manifestPath = path.join(bundleDir, 'manifest.json');

const readJson = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const slugifyPackage = (pkg) => (
  String(pkg)
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .toLowerCase()
);

const resolveSheetPath = (pkg, manifestMap) => {
  const sheet = manifestMap.get(pkg);
  if (sheet) return path.join(bundleDir, sheet);
  return path.join(bundleDir, 'deps', `${slugifyPackage(pkg)}.md`);
};

const formatList = (items) => items.map((item) => `- ${item}`).join('\n');

const run = async () => {
  const errors = [];
  if (!fs.existsSync(criticalPath)) {
    console.error(`Missing critical dependency list: ${criticalPath}`);
    process.exit(1);
  }

  const critical = await readJson(criticalPath);
  const criticalPackages = Array.isArray(critical?.packages)
    ? critical.packages
        .map((entry) => entry?.package)
        .filter(Boolean)
    : [];

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Missing manifest: ${manifestPath}`);
  }

  let manifestMap = new Map();
  if (fs.existsSync(manifestPath)) {
    const manifest = await readJson(manifestPath);
    if (Array.isArray(manifest?.packages)) {
      manifestMap = new Map(
        manifest.packages
          .filter((entry) => entry?.package && entry?.sheet)
          .map((entry) => [entry.package, entry.sheet])
      );
    }
  }

  const missingSheets = [];
  const missingManifest = [];

  for (const pkg of criticalPackages) {
    if (!manifestMap.has(pkg)) {
      missingManifest.push(pkg);
    }
    const sheetPath = resolveSheetPath(pkg, manifestMap);
    if (!fs.existsSync(sheetPath)) {
      missingSheets.push(`${pkg} -> ${sheetPath}`);
    }
  }

  if (missingManifest.length) {
    errors.push('Missing manifest entries:\n' + formatList(missingManifest));
  }
  if (missingSheets.length) {
    errors.push('Missing dependency sheets:\n' + formatList(missingSheets));
  }

  if (errors.length) {
    console.error('Critical dependency validation failed.');
    console.error(errors.join('\n\n'));
    process.exit(1);
  }

  console.log('Critical dependency validation passed.');
};

run().catch((err) => {
  console.error(`Critical dependency validation failed: ${err?.message || err}`);
  process.exit(1);
});
