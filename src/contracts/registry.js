import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { ARTIFACT_SCHEMA_DEFS } from './schemas/artifacts.js';
import { BUILD_STATE_SCHEMA } from './schemas/build-state.js';
import { USR_SCHEMA_DEFS } from './schemas/usr.js';
import { USR_MATRIX_SCHEMA_DEFS } from './schemas/usr-matrix.js';
import { WORKSPACE_SCHEMA_DEFS } from './schemas/workspace.js';

export { ARTIFACT_SCHEMA_DEFS };
export const ARTIFACT_SCHEMA_REGISTRY = ARTIFACT_SCHEMA_DEFS;
export const ARTIFACT_SCHEMA_HASH = sha1(stableStringify(ARTIFACT_SCHEMA_DEFS));
export const ARTIFACT_SCHEMA_NAMES = Object.freeze(Object.keys(ARTIFACT_SCHEMA_DEFS));
export const BUILD_STATE_SCHEMA_HASH = sha1(stableStringify(BUILD_STATE_SCHEMA));
export { BUILD_STATE_SCHEMA };

export const USR_SCHEMA_REGISTRY = USR_SCHEMA_DEFS;
export const USR_SCHEMA_HASH = sha1(stableStringify(USR_SCHEMA_DEFS));
export const USR_SCHEMA_NAMES = Object.freeze(Object.keys(USR_SCHEMA_DEFS));
export const USR_MATRIX_SCHEMA_REGISTRY = USR_MATRIX_SCHEMA_DEFS;
export const USR_MATRIX_SCHEMA_HASH = sha1(stableStringify(USR_MATRIX_SCHEMA_DEFS));
export const USR_MATRIX_SCHEMA_NAMES = Object.freeze(Object.keys(USR_MATRIX_SCHEMA_DEFS));
export const WORKSPACE_SCHEMA_REGISTRY = WORKSPACE_SCHEMA_DEFS;
export const WORKSPACE_SCHEMA_HASH = sha1(stableStringify(WORKSPACE_SCHEMA_DEFS));
export const WORKSPACE_SCHEMA_NAMES = Object.freeze(Object.keys(WORKSPACE_SCHEMA_DEFS));

export const getArtifactSchema = (name) => ARTIFACT_SCHEMA_DEFS[name] || null;
export const getUsrSchema = (name) => USR_SCHEMA_DEFS[name] || null;
export const getUsrMatrixSchema = (name) => USR_MATRIX_SCHEMA_DEFS[name] || null;
export const getWorkspaceSchema = (name) => WORKSPACE_SCHEMA_DEFS[name] || null;
