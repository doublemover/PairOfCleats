import fs from 'node:fs';
import path from 'node:path';
import { loadPiecesManifest } from '../../shared/artifact-io.js';
import { checksumFile, sha1File } from '../../shared/hash.js';
import { fromPosix, isAbsolutePath } from '../../shared/files.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../../contracts/versioning.js';
import { isManifestPathSafe, normalizeManifestPath } from './paths.js';
import { addIssue } from './issues.js';
import { validateManifestEntries, validateSchema } from './schema.js';

export const loadAndValidateManifest = async ({ report, mode, dir, strict, modeReport }) => {
  let manifest = null;
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const message = 'pieces/manifest.json missing';
    if (strict) {
      modeReport.ok = false;
      modeReport.missing.push(message);
      report.issues.push(`[${mode}] ${message}`);
    } else {
      modeReport.warnings.push(message);
      report.warnings.push(`[${mode}] ${message}`);
    }
    return { manifest };
  }

  try {
    manifest = loadPiecesManifest(dir, { strict });
    validateSchema(
      report,
      mode,
      'pieces_manifest',
      manifest,
      'Rebuild index artifacts for this mode.',
      { strictSchema: strict }
    );
    if (strict) {
      if (!isSupportedVersion(manifest?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
        addIssue(
          report,
          mode,
          `artifactSurfaceVersion unsupported: ${manifest?.artifactSurfaceVersion ?? 'missing'}`,
          'Rebuild index artifacts for this mode.'
        );
      }
      validateManifestEntries(report, mode, dir, manifest, { strictSchema: true });
    }
    if (!manifest || !Array.isArray(manifest.pieces)) {
      const issue = 'pieces/manifest.json invalid';
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    } else {
      for (const piece of manifest.pieces) {
        const relPath = piece?.path;
        if (!relPath) continue;
        if (!isManifestPathSafe(relPath)) {
          const issue = `unsafe manifest path: ${relPath}`;
          if (strict) {
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          } else {
            modeReport.warnings.push(issue);
            report.warnings.push(`[${mode}] ${issue}`);
          }
          continue;
        }
        const absPath = path.resolve(dir, fromPosix(normalizeManifestPath(relPath)));
        const root = path.resolve(dir);
        const relative = path.relative(root, absPath);
        if (relative.startsWith('..') || isAbsolutePath(relative)) {
          const issue = `manifest path escapes index root: ${relPath}`;
          if (strict) {
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          } else {
            modeReport.warnings.push(issue);
            report.warnings.push(`[${mode}] ${issue}`);
          }
          continue;
        }
        if (!fs.existsSync(absPath)) {
          const issue = `piece missing: ${relPath}`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
          continue;
        }
        const checksum = typeof piece?.checksum === 'string' ? piece.checksum : '';
        if (checksum) {
          const [algo, expected] = checksum.split(':');
          if (!algo || !expected) {
            const warning = `piece checksum invalid: ${relPath}`;
            modeReport.warnings.push(warning);
            report.warnings.push(`[${mode}] ${warning}`);
            continue;
          }
          if (algo === 'sha1') {
            const actual = await sha1File(absPath);
            if (actual !== expected) {
              const issue = `piece checksum mismatch: ${relPath}`;
              modeReport.ok = false;
              modeReport.missing.push(issue);
              report.issues.push(`[${mode}] ${issue}`);
              report.hints.push('Run `pairofcleats index build` to refresh index artifacts.');
            }
          } else if (algo === 'xxh64') {
            const actual = await checksumFile(absPath);
            if (!actual || actual.value !== expected) {
              const issue = `piece checksum mismatch: ${relPath}`;
              modeReport.ok = false;
              modeReport.missing.push(issue);
              report.issues.push(`[${mode}] ${issue}`);
              report.hints.push('Run `pairofcleats index build` to refresh index artifacts.');
            }
          } else {
            const warning = `piece checksum unsupported: ${relPath}`;
            modeReport.warnings.push(warning);
            report.warnings.push(`[${mode}] ${warning}`);
          }
        }
      }
    }
  } catch (err) {
    const issue = 'pieces/manifest.json invalid';
    modeReport.ok = false;
    modeReport.missing.push(issue);
    report.issues.push(`[${mode}] ${issue}`);
    if (strict) {
      report.hints.push('Rebuild index artifacts for this mode.');
    }
  }

  return { manifest };
};

export const sumManifestCounts = (manifest, name) => {
  if (!manifest || !Array.isArray(manifest.pieces)) return null;
  let total = 0;
  let saw = false;
  for (const piece of manifest.pieces) {
    if (piece?.name !== name) continue;
    const count = Number(piece?.count);
    if (!Number.isFinite(count)) continue;
    total += count;
    saw = true;
  }
  return saw ? total : null;
};
