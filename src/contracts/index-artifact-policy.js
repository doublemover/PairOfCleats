import { ARTIFACT_SCHEMA_DEFS } from './artifact-schemas.js';
import { createAjv, compileSchema } from '../shared/validation/ajv-factory.js';
import { assertKnownIndexProfileId, resolveRequiredArtifactsForProfile } from './index-profile.js';
import { stableStringify } from '../shared/stable-json.js';

const envelopeSchema = { type: 'object', additionalProperties: false, properties: {
  profile: ARTIFACT_SCHEMA_DEFS.index_state.properties.profile,
  artifacts: ARTIFACT_SCHEMA_DEFS.index_state.properties.artifacts
} };
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), envelopeSchema);
const invalid = message => Object.assign(new Error(`Invalid persisted artifact policy: ${message}`), { code: 'ERR_INDEX_ARTIFACT_POLICY' });

/** Admit a generation's persisted policy before deriving its reader requirements. */
export const resolveIndexArtifactPolicy = ({ state, manifest, resolvePresence, producerPolicy = null }) => {
  const envelope = Object.fromEntries(['profile', 'artifacts'].filter(key => Object.hasOwn(state || {}, key))
    .map(key => [key, state[key]]));
  if (!validate(envelope)) throw invalid(JSON.stringify(validate.errors));
  if (manifest?.profile != null && !validate({ profile: manifest.profile })) throw invalid('manifest profile envelope is invalid');
  const profiles = [state?.profile?.id, manifest?.profile?.id, manifest?.profileId]
    .filter(value => value != null).map(value => {
      if (typeof value !== 'string' || !value.trim()) throw invalid('explicit profile ID is invalid');
      return assertKnownIndexProfileId(value);
    });
  if (new Set(profiles).size > 1) throw invalid('conflicting profile IDs');
  const profileId = profiles[0] || 'default';
  const required = resolveRequiredArtifactsForProfile(profileId);
  const declared = name => {
    const presence = resolvePresence(name);
    if (presence?.error) throw presence.error;
    return Boolean(presence && presence.format !== 'missing');
  };
  const artifacts = state?.artifacts;
  if (artifacts) {
    if (Object.keys(artifacts.present).length > 128 || artifacts.omitted.length > 128
      || artifacts.requiredForSearch.length > 128) throw invalid('capability envelope exceeds its bound');
    const canonicalRequired = [...new Set(artifacts.requiredForSearch)].sort();
    if (stableStringify(canonicalRequired) !== stableStringify([...required].sort())) throw invalid('requiredForSearch differs from profile');
    const omitted = Object.keys(artifacts.present).filter(name => !artifacts.present[name]).sort();
    if (stableStringify(omitted) !== stableStringify([...new Set(artifacts.omitted)].sort())) throw invalid('omitted contradicts present');
    const conflicts = [];
    for (const name of required) if (artifacts.present[name] !== true) conflicts.push(`required ${name} is not present`);
    for (const [name, present] of Object.entries(artifacts.present)) {
      if (declared(name) !== present) conflicts.push(`${name} presence contradicts manifest`);
    }
    if (conflicts.length) throw invalid(conflicts.join('; '));
  }
  if (producerPolicy && stableStringify(producerPolicy) !== stableStringify(envelope)) throw invalid('same-run producer plan differs from persisted policy');
  const sparseEnabled = profileId !== 'vector_only';
  const present = name => artifacts && Object.hasOwn(artifacts.present, name) ? artifacts.present[name] === true : declared(name);
  return { profileId, sparseEnabled, required,
    postings: { fielded: sparseEnabled && present('field_postings'),
      enablePhraseNgrams: sparseEnabled && present('phrase_ngrams'),
      enableChargrams: sparseEnabled && present('chargram_postings') },
    determinismReport: declared('determinism_report'),
    lancedbEnabled: ['dense_vectors_lancedb_meta', 'dense_vectors_doc_lancedb_meta', 'dense_vectors_code_lancedb_meta'].some(declared),
    envelope };
};
