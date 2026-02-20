import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../../../shared/hash.js';
import { createFsMemo } from './fs-meta.js';
import { sortStrings } from './path-utils.js';

export const resolveGoModulePath = (rootAbs, fsMemo = null) => {
  const io = fsMemo || createFsMemo();
  const goModPath = path.join(rootAbs, 'go.mod');
  if (!io.existsSync(goModPath)) return null;
  try {
    const text = fs.readFileSync(goModPath, 'utf8');
    const match = text.match(/^\s*module\s+([^\s]+)\s*$/m);
    return match?.[1] ? String(match[1]).trim() : null;
  } catch {
    return null;
  }
};

export const resolveDartPackageName = (rootAbs, fsMemo = null) => {
  const io = fsMemo || createFsMemo();
  const pubspecPath = path.join(rootAbs, 'pubspec.yaml');
  if (!io.existsSync(pubspecPath)) return null;
  try {
    const text = fs.readFileSync(pubspecPath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || '');
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (/^\s/.test(line)) continue;
      const match = trimmed.match(/^name\s*:\s*["']?([A-Za-z0-9_.-]+)["']?\s*(?:#.*)?$/);
      if (match?.[1]) return match[1];
    }
  } catch {}
  return null;
};

export const resolvePackageFingerprint = (rootAbs, fsMemo = null) => {
  const io = fsMemo || createFsMemo();
  if (!rootAbs) return null;
  const fingerprintParts = [];
  const files = ['package.json', 'go.mod', 'pubspec.yaml'];
  for (const rel of files) {
    const abs = path.join(rootAbs, rel);
    if (!io.existsSync(abs)) continue;
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      fingerprintParts.push(`${rel}:${sha1(raw)}`);
    } catch {}
  }
  if (!fingerprintParts.length) return null;
  try {
    fingerprintParts.sort(sortStrings);
    return sha1(fingerprintParts.join('\n'));
  } catch {
    return null;
  }
};
