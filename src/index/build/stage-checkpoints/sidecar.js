import { encodeFilenameKey } from '../../../shared/filename-key.js';
export const STAGE_CHECKPOINTS_SIDECAR_VERSION = 1;
export const STAGE_CHECKPOINTS_SIDECAR_PREFIX = `stage_checkpoints.v${STAGE_CHECKPOINTS_SIDECAR_VERSION}`;
export const STAGE_CHECKPOINTS_INDEX_BASENAME = `${STAGE_CHECKPOINTS_SIDECAR_PREFIX}.index.json`;

/**
 * Normalize a checkpoint mode string so sidecar file names remain portable
 * across filesystems while preserving stable, deterministic naming.
 * @param {string} mode
 * @returns {string}
 */
export const sanitizeStageCheckpointMode = encodeFilenameKey;

/**
 * Build the per-mode stage checkpoint sidecar basename.
 * @param {string} mode
 * @returns {string}
 */
export const buildStageCheckpointModeBasename = (mode) => (
  `${STAGE_CHECKPOINTS_SIDECAR_PREFIX}.${sanitizeStageCheckpointMode(mode)}.json`
);
