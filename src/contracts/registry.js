import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { ARTIFACT_SCHEMA_DEFS } from './schemas/artifacts.js';
import { BUILD_STATE_SCHEMA } from './schemas/build-state.js';

export { ARTIFACT_SCHEMA_DEFS };
export const ARTIFACT_SCHEMA_REGISTRY = ARTIFACT_SCHEMA_DEFS;
export const ARTIFACT_SCHEMA_HASH = sha1(stableStringify(ARTIFACT_SCHEMA_DEFS));
export const ARTIFACT_SCHEMA_NAMES = Object.freeze(Object.keys(ARTIFACT_SCHEMA_DEFS));
export const BUILD_STATE_SCHEMA_HASH = sha1(stableStringify(BUILD_STATE_SCHEMA));
export { BUILD_STATE_SCHEMA };

export const getArtifactSchema = (name) => ARTIFACT_SCHEMA_DEFS[name] || null;
