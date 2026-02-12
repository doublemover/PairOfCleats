import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_SCHEMA_DEFS,
  USR_EVIDENCE_ENVELOPE_SCHEMA,
  USR_REPORT_SCHEMA_DEFS,
  USR_CAPABILITY_TRANSITION_SCHEMA
} from '../schemas/usr.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

export const USR_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema)])
  )
);

const REPORT_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.keys(USR_REPORT_SCHEMA_DEFS).map((name) => [name, USR_VALIDATORS[name]])
  )
);

const EVIDENCE_ENVELOPE_VALIDATOR = compileSchema(ajv, USR_EVIDENCE_ENVELOPE_SCHEMA);
const CAPABILITY_TRANSITION_VALIDATOR = compileSchema(ajv, USR_CAPABILITY_TRANSITION_SCHEMA);

export function validateUsrSchema(name, payload) {
  const validator = USR_VALIDATORS[name];
  if (!validator) {
    return { ok: false, errors: [`unknown USR schema: ${name}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function validateUsrEvidenceEnvelope(payload) {
  const ok = Boolean(EVIDENCE_ENVELOPE_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(EVIDENCE_ENVELOPE_VALIDATOR) };
}

export function validateUsrReport(artifactId, payload) {
  const validator = REPORT_VALIDATORS[artifactId];
  if (!validator) {
    return { ok: false, errors: [`unknown USR report schema: ${artifactId}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function validateUsrCapabilityTransition(payload) {
  const ok = Boolean(CAPABILITY_TRANSITION_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(CAPABILITY_TRANSITION_VALIDATOR) };
}
