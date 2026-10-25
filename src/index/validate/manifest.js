import { runWithSettledConcurrency } from '../../shared/concurrency/run-with-queue.js';
import { isAbortError, throwIfAborted } from '../../shared/abort.js';
import path from 'node:path';
import { loadPiecesManifestWithReadPlan } from '../../shared/artifact-io/manifest.js';
import { existsOrBak } from '../../shared/artifact-io/fs.js';
import { checksumFile, sha1File, sha256File } from '../../shared/hash.js';
import { fromPosix, isAbsolutePathNative, isRelativePathEscape } from '../../shared/file-paths.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../../contracts/versioning.js';
import { isManifestPathSafe, normalizeManifestPath } from './paths.js';
import { addIssue, validationFindings, mergeValidationFindings } from './issues.js';
import { validateManifestEntries, validateSchema } from './schema.js';

const verifyManifestPiece = async ({ report, mode, dir, strict, modeReport, piece, readPlan = null, signal = null }) => {
  throwIfAborted(signal);
  const relPath = piece?.path;
  if (!relPath) return;
  if (!isManifestPathSafe(relPath)) {
    const issue = `unsafe manifest path: ${relPath}`;
    if (strict) {
      modeReport.ok = false;
      modeReport.missing.push(issue);
      addIssue(report, mode, issue);
    } else {
      modeReport.warnings.push(issue);
      addIssue(report, mode, issue, null, 'warnings');
    }
    return;
  }
  const absPath = path.resolve(dir, fromPosix(normalizeManifestPath(relPath)));
  const root = path.resolve(dir);
  const relative = path.relative(root, absPath);
  if (isRelativePathEscape(relative) || isAbsolutePathNative(relative)) {
    const issue = `manifest path escapes index root: ${relPath}`;
    if (strict) {
      modeReport.ok = false;
      modeReport.missing.push(issue);
      addIssue(report, mode, issue);
    } else {
      modeReport.warnings.push(issue);
      addIssue(report, mode, issue, null, 'warnings');
    }
    return;
  }
  if (!existsOrBak(absPath)) {
    const issue = `piece missing: ${relPath}`;
    modeReport.ok = false;
    modeReport.missing.push(issue);
    addIssue(report, mode, issue, null, 'issues', { state: 'missing', artifact: piece.name || relPath, code: 'ERR_INDEX_PIECE_MISSING' });
    return;
  }
  const checksum = typeof piece?.checksum === 'string' ? piece.checksum : '';
  if (checksum) {
    const match = /^(sha1|sha256|xxh64):([0-9a-f]+)$/i.exec(checksum);
    const lengths = { sha1: 40, sha256: 64, xxh64: 16 };
    const algorithm = match?.[1]?.toLowerCase();
    const expected = match?.[2]?.toLowerCase();
    if (!algorithm || expected.length !== lengths[algorithm]) {
      const issue = `piece checksum invalid or unsupported: ${relPath}`;
      if (strict) {
        modeReport.ok = false;
        modeReport.missing.push(issue);
        addIssue(report, mode, issue);
      } else {
        modeReport.warnings.push(issue);
        addIssue(report, mode, issue, null, 'warnings');
      }
      return;
    }
    const actual = readPlan ? await readPlan.checksum(absPath, algorithm)
      : algorithm === 'sha1'
        ? await sha1File(absPath, { containedRoot: strict ? dir : null, signal })
        : algorithm === 'sha256'
          ? await sha256File(absPath, { containedRoot: strict ? dir : null, signal })
          : (await checksumFile(absPath, { containedRoot: strict ? dir : null, signal }))?.value;
    if (actual?.toLowerCase() !== expected) {
      const issue = `piece checksum mismatch: ${relPath}`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      addIssue(report, mode, issue, null, 'issues', { artifact: piece.name || relPath, code: 'ERR_INDEX_PIECE_CHECKSUM' });
      report.hints.push('Run `pairofcleats index build` to refresh index artifacts.');
    }
  }
};

const verifyManifestPieces = async input => {
  const { manifest, report, modeReport, signal } = input;
  // Bound retained diagnostics and descriptors to four pieces. Merge in the
  // original manifest order so parallel hashing cannot reorder output.
  for (let start = 0; start < manifest.pieces.length; start += 4) {
    const results = await runWithSettledConcurrency(manifest.pieces.slice(start, start + 4), 4, async piece => {
      const localMode = { ok: true, missing: [], warnings: [] };
      const localReport = { issues: [], warnings: [], hints: [] };
      await verifyManifestPiece({ ...input, piece, modeReport: localMode, report: localReport });
      return { mode: localMode, report: localReport };
    }, { signal, collectResults: true });
    for (const result of results) {
      if (!result.mode.ok) modeReport.ok = false;
      modeReport.missing.push(...result.mode.missing); modeReport.warnings.push(...result.mode.warnings);
      mergeValidationFindings(report, result.report); report.hints.push(...result.report.hints);
    }
  }
};

const insertDiagnostics = (target, index, values) => {
  for (let offset = 0; offset < values.length; offset += 2048) {
    target.splice(index + offset, 0, ...values.slice(offset, offset + 2048));
  }
};

const reportManifestFailure = ({ report, mode, dir, strict, modeReport }, err) => {
  if (isAbortError(err)) throw err;
  // The exact-format gate also rejects absent manifests. Preserve the
  // actionable missing-vs-invalid diagnostic without admitting either.
  const missing = err?.code === 'ERR_MANIFEST_MISSING'
    || (err?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED' && !existsOrBak(path.join(dir, 'pieces', 'manifest.json')));
  const issue = missing
    ? 'pieces/manifest.json missing'
    : 'pieces/manifest.json invalid';
  if (strict) {
    modeReport.ok = false;
    modeReport.missing.push(issue);
    addIssue(report, mode, issue, null, 'issues', { state: missing ? 'missing' : 'invalid', artifact: 'pieces_manifest', code: missing ? 'ERR_INDEX_MANIFEST_MISSING' : 'ERR_INDEX_MANIFEST_INVALID' });
    report.hints.push('Rebuild index artifacts for this mode.');
  } else {
    modeReport.warnings.push(issue);
    addIssue(report, mode, issue, null, 'warnings', { state: 'unverified', artifact: 'pieces_manifest', code: 'WARN_INDEX_MANIFEST_UNVERIFIED' });
  }
};

export const loadAndValidateManifest = async ({ report, mode, dir, strict, modeReport, readPlan = null, signal = null }) => {
  let manifest = null;
  let finalizeManifest = async () => {};

  try {
    manifest = await loadPiecesManifestWithReadPlan(dir, { strict });
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
      addIssue(report, mode, issue);
    } else {
      if (readPlan && await readPlan.prepare(manifest)) {
        const anchors = { findings: validationFindings(report).length, hints: report.hints.length,
          missing: modeReport.missing.length, modeWarnings: modeReport.warnings.length };
        let finalized = false;
        finalizeManifest = async () => {
          if (finalized) return;
          finalized = true;
          const pieceReport = { issues: [], warnings: [], hints: [] };
          const pieceModeReport = { ok: true, missing: [], warnings: [] };
          const pieceInput = { report: pieceReport, mode, dir, strict, modeReport: pieceModeReport, manifest, readPlan, signal };
          try {
            await verifyManifestPieces(pieceInput);
            readPlan.finish();
          } catch (error) { reportManifestFailure(pieceInput, error); }
          // Manifest diagnostics keep their original position before family/schema diagnostics.
          mergeValidationFindings(report, pieceReport, anchors.findings);
          insertDiagnostics(report.hints, anchors.hints, pieceReport.hints);
          insertDiagnostics(modeReport.missing, anchors.missing, pieceModeReport.missing);
          insertDiagnostics(modeReport.warnings, anchors.modeWarnings, pieceModeReport.warnings);
          if (!pieceModeReport.ok) modeReport.ok = false;
        };
      } else {
        await verifyManifestPieces({ report, mode, dir, strict, modeReport, manifest, signal });
      }
    }
  } catch (err) {
    reportManifestFailure({ report, mode, dir, strict, modeReport }, err);
  }

  return { manifest, finalizeManifest };
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
