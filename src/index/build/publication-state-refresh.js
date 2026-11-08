import path from 'node:path';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { assertArtifactFilePath } from '../../shared/artifact-io/contained-path.js';
import { stableStringify } from '../../shared/stable-json.js';
import { assertArtifactPublicationReady, readArtifactPublicationRecord,
  writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from './artifact-publication.js';

const readJson = async (root, filename) => JSON.parse((await readVerifiedContainedFile(root,
  assertArtifactFilePath(root, filename), { maxBytes: 16 * 1024 * 1024 })).buffer.toString('utf8'));

const previousRecord = async (buildRoot, mode) => {
  try { return await readArtifactPublicationRecord(buildRoot, mode); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
};

/** The shared state owner may refresh an already valid generation after its
 * controlled state/manifest mutation. Arbitrary stale state cannot grant this. */
export const capturePublishedStateRefresh = async (outDir, mode) => {
  if (!mode || path.basename(outDir) !== `index-${mode}`) return null;
  const buildRoot = path.dirname(outDir), prior = await previousRecord(buildRoot, mode);
  if (!prior || prior.status !== 'published') return null;
  await assertArtifactPublicationReady({ buildRoot, modes: [mode] });
  return { buildRoot, outDir, mode, prior };
};

/** Called under the existing index-state publication lock. Stage3 calls this
 * only after its complete producer validation and final ready-state write. */
export const refreshArtifactPublication = async ({ buildRoot, outDir, mode, prior = null, producerPolicy = null }) => {
  prior ||= await previousRecord(buildRoot, mode);
  if (!prior) return;
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const manifest = await readJson(outDir, manifestPath);
  let familyDeclarations = [];
  const validationPath = prior.publicationValidation?.validationPath;
  if (validationPath) {
    const validation = await readJson(buildRoot, validationPath);
    if (stableStringify(validation.integrityBinding) !== stableStringify(prior.publicationValidation.integrityBinding)) {
      throw new Error('[artifact-publication] retained validation report differs from its published authority.');
    }
    familyDeclarations = validation.families;
  }
  const input = { buildRoot, outDir, mode, buildId: prior.buildId, manifestPath,
    pieceEntries: manifest.pieces, familyDeclarations,
    producerPolicy: producerPolicy || prior.publicationValidation?.producerPolicy || null };
  const publicationValidation = await writeArtifactPublicationValidationReport(input);
  if (publicationValidation.payload.ok !== true) throw new Error('[artifact-publication] state mutation failed generation requalification.');
  await writeArtifactPublicationRecord({ ...input, stage: prior.stage,
    artifactSurfaceVersion: prior.artifactSurfaceVersion, compatibilityKey: prior.compatibilityKey,
    identityReconciliation: prior.identityReconciliation, cleanup: prior.cleanup, publicationValidation });
};
