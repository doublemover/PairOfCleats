import fs from 'node:fs/promises';
import path from 'node:path';
import { toRealPathSync, isWithinRoot } from '../../../workspace/identity.js';
import { toPosix, isRelativePathEscape, fileExt } from '../../../shared/file-paths.js';
import { watchObservationFailure } from './source-observations.js';
import { inspectGeneratedArtifact, isGeneratedArtifactCandidatePath } from '../../../shared/generated-artifact.js';
import { EXTS_CODE, EXTS_PROSE, resolveSpecialCodeExt, isSpecialCodeFile, isManifestFile, isLockFile } from '../../constants.js';
import { getLanguageForFile } from '../../language-registry.js';
import { detectShebangLanguage } from '../shebang.js';
import { resolveGeneratedPolicyDecision, buildGeneratedPolicyDowngradePayload } from '../generated-policy.js';
import { readRecordSample } from './records.js';
import { resolveMaxBytesForFile } from './guardrails.js';

export const createWatchPathClassifier = ({ root, canonicalRoot, normalizedRecordsRoot, maxDepthCap,
  ignoreMatcher, maxFileBytes, fileCaps, recordsClassifier, generatedPolicy, lstatPath = file => fs.lstat(file) }) => async (absPath) => {
  const canonicalAbs = toRealPathSync(absPath);
  if (!isWithinRoot(canonicalAbs, canonicalRoot)) {
    return { skip: true, reason: 'outside-root' };
  }
  const relPosix = toPosix(path.relative(canonicalRoot, canonicalAbs));
  if (!relPosix || relPosix === '.' || isRelativePathEscape(relPosix)) {
    return { skip: true, reason: 'outside-root' };
  }
  const inRecordsRoot = normalizedRecordsRoot
    ? isWithinRoot(canonicalAbs, normalizedRecordsRoot)
    : false;
  if (maxDepthCap != null) {
    const depth = relPosix.split('/').length - 1;
    if (depth > maxDepthCap) {
      return { skip: true, reason: 'max-depth', extra: { depth, maxDepth: maxDepthCap } };
    }
  }
  if (ignoreMatcher?.ignores(relPosix)) {
    return { skip: true, reason: 'ignored' };
  }
  const baseName = path.basename(absPath);
  let ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
  let stat;
  try {
    stat = await lstatPath(absPath);
  } catch (error) {
    return watchObservationFailure(error);
  }
  if (stat.isSymbolicLink()) {
    return { skip: true, reason: 'symlink' };
  }
  let language = getLanguageForFile(ext, relPosix);
  if (!ext && !language && stat.isFile()) {
    const shebang = await detectShebangLanguage(absPath);
    if (shebang?.languageId) {
      ext = shebang.ext || ext;
      language = getLanguageForFile(ext, relPosix);
    }
  }
  const maxBytesForFile = resolveMaxBytesForFile(ext, language?.id || null, maxFileBytes, fileCaps);
  if (maxBytesForFile && stat.size > maxBytesForFile) {
    return {
      skip: true,
      reason: 'oversize',
      extra: {
        stage: 'watch',
        capSource: 'maxBytes',
        bytes: stat.size,
        maxBytes: maxBytesForFile
      }
    };
  }
  const isSpecialLanguage = !!language && !EXTS_CODE.has(ext) && !EXTS_PROSE.has(ext);
  const isSpecial = isSpecialCodeFile(baseName) || isManifestFile(baseName) || isLockFile(baseName) || isSpecialLanguage;
  let record = null;
  if (inRecordsRoot) {
    record = { source: 'triage', recordType: 'record', reason: 'records-dir' };
  }
  if (!record && recordsClassifier) {
    const sampleText = recordsClassifier.shouldSniff({ absPath, relPath: relPosix, ext })
      ? await readRecordSample(absPath, recordsClassifier.config?.sniffBytes)
      : '';
    record = recordsClassifier.classify({ absPath, relPath: relPosix, ext, sampleText });
  }
  // Preserve records routing even when generated-policy heuristics match.
  if (!record) {
    if (stat.isFile() && isGeneratedArtifactCandidatePath(relPosix)) {
      const artifact = await inspectGeneratedArtifact({ repoRoot: root, filePath: absPath, relativePath: relPosix });
      if (artifact?.action === 'omit') {
        return { skip: true, reason: 'generated-artifact', extra: {
          artifactKind: artifact.kind, artifactFormat: artifact.format, artifactFlags: artifact.flags, action: artifact.action
        } };
      }
    }
    const generatedPolicyDecision = resolveGeneratedPolicyDecision({
      generatedPolicy,
      relPath: relPosix,
      absPath,
      baseName
    });
    if (generatedPolicyDecision?.downgrade) {
      return {
        skip: true,
        reason: generatedPolicyDecision.classification || 'generated',
        extra: {
          indexMode: generatedPolicyDecision.indexMode,
          downgrade: buildGeneratedPolicyDowngradePayload(generatedPolicyDecision)
        }
      };
    }
  }
  return {
    skip: false,
    relPosix,
    ext,
    stat,
    record,
    isSpecial
  };
};
