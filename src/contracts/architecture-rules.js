export const ARCHITECTURE_RULES_VERSION = 1;
const SELECTOR_FIELDS = Object.freeze(['anyOf', 'noneOf']);
const BASE_FIELDS = Object.freeze(['id', 'type', 'severity', 'message']);
const TYPES = Object.freeze(['forbiddenImport', 'forbiddenCall', 'layering']);
const nonemptyString = { type: 'string', minLength: 1 };
const selectorSchema = { type: 'object', properties: Object.fromEntries(SELECTOR_FIELDS.map(key => [key,
  { type: 'array', items: nonemptyString }])), additionalProperties: false };
const base = { id: { type: 'string', minLength: 1, pattern: '\\S' }, type: { type: 'string' },
  severity: { type: ['string', 'null'] }, message: { type: ['string', 'null'] } };

export const ARCHITECTURE_RULES_SCHEMA = {
  type: 'object', required: ['version', 'rules'], additionalProperties: false,
  properties: { version: { const: ARCHITECTURE_RULES_VERSION, type: 'integer' }, rules: { type: 'array', items: { oneOf: [
    { type: 'object', required: ['id', 'type'], additionalProperties: false,
      properties: { ...base, type: { enum: TYPES.slice(0, 2) }, from: selectorSchema, to: selectorSchema } },
    { type: 'object', required: ['id', 'type', 'layers'], additionalProperties: false,
      properties: { ...base, type: { const: 'layering' }, layers: { type: 'array', minItems: 1,
        items: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, pattern: '\\S' }, match: selectorSchema },
          additionalProperties: false } } } }
  ] } } }
};

export const architectureRuleInputError = ({ message, propertyPath = 'rules', ruleIndex = null, ruleId = null, cause } = {}) =>
  Object.assign(new Error(`Architecture rule input rejected at ${propertyPath}${ruleId ? ` (${ruleId})` : ''}: ${message}`, { cause }),
    { code: 'ERR_ARCHITECTURE_RULE_INPUT', propertyPath, ruleIndex, ruleId });

/** Synchronous structural admission stays independent of the report validators
 * and their transitive schema/compiler dependencies. Both entry paths snapshot
 * this canonical versioned shape before the existing compilation cache.
 */
export const normalizeArchitectureRules = (input, { allowArray = false } = {}) => {
  const reject = (propertyPath, message, ruleIndex = null, ruleId = null) => {
    throw architectureRuleInputError({ propertyPath, message, ruleIndex, ruleId });
  };
  const record = (value, propertyPath, fields, ruleIndex = null, ruleId = null) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject(propertyPath, 'must be an object', ruleIndex, ruleId);
    for (const key of Object.keys(value)) {
      if (!fields.includes(key)) reject(`${propertyPath}.${key}`, 'unsupported property', ruleIndex, ruleId);
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) reject(`${propertyPath}.${key}`, 'accessor values are unsupported', ruleIndex, ruleId);
    }
    return value;
  };
  const payload = allowArray && Array.isArray(input) ? { version: ARCHITECTURE_RULES_VERSION, rules: input } : input;
  record(payload, 'policy', ['version', 'rules']);
  if (payload.version !== ARCHITECTURE_RULES_VERSION) reject('version', 'must be the number 1');
  if (!Array.isArray(payload.rules)) reject('rules', 'must be an array');
  const seenIds = new Map();
  // Duplicate normalized IDs retain their established error code on both routes,
  // even when the duplicated rule also has a separate malformed selector.
  for (let index = 0; index < payload.rules.length; index++) {
    const descriptor = payload.rules[index] && Object.getOwnPropertyDescriptor(payload.rules[index], 'id');
    const id = typeof descriptor?.value === 'string' ? descriptor.value.trim() : '';
    if (!id) continue;
    if (seenIds.has(id)) throw Object.assign(architectureRuleInputError({ propertyPath: `rules[${index}].id`,
      message: `duplicate normalized id at entries ${seenIds.get(id) + 1} and ${index + 1}`, ruleIndex: index, ruleId: id }),
    { code: 'ERR_ARCHITECTURE_DUPLICATE_RULE_ID', indices: [seenIds.get(id), index] });
    seenIds.set(id, index);
  }
  const selector = (value, propertyPath, index, id) => {
    record(value, propertyPath, SELECTOR_FIELDS, index, id);
    const normalized = {};
    for (const key of SELECTOR_FIELDS) {
      if (!Object.hasOwn(value, key)) continue;
      if (!Array.isArray(value[key])) reject(`${propertyPath}.${key}`, 'must be an array of nonempty glob strings', index, id);
      normalized[key] = Object.freeze(Array.from(value[key], (pattern, ordinal) => {
        if (typeof pattern !== 'string' || !pattern) reject(`${propertyPath}.${key}[${ordinal}]`, 'must be a nonempty glob string', index, id);
        return pattern;
      }));
    }
    return Object.freeze(normalized);
  };
  const rules = Array.from(payload.rules, (rule, index) => {
    const location = `rules[${index}]`;
    const descriptor = rule && Object.getOwnPropertyDescriptor(rule, 'id');
    const idHint = typeof descriptor?.value === 'string' ? descriptor.value.trim() : null;
    record(rule, location, [...BASE_FIELDS, 'from', 'to', 'layers'], index, idHint);
    if (typeof rule.id !== 'string' || !rule.id.trim()) reject(`${location}.id`, 'must be a nonempty string', index);
    const id = rule.id.trim();
    if (!TYPES.includes(rule.type)) reject(`${location}.type`, `must be one of ${TYPES.join(', ')}`, index, id);
    for (const key of ['severity', 'message']) if (rule[key] !== undefined && rule[key] !== null && typeof rule[key] !== 'string') {
      reject(`${location}.${key}`, 'must be a string or null', index, id);
    }
    const normalized = { id, type: rule.type, severity: rule.severity ?? null, message: rule.message ?? null };
    if (rule.type !== 'layering') {
      if (Object.hasOwn(rule, 'layers')) reject(`${location}.layers`, 'is unsupported for this rule type', index, id);
      return Object.freeze({ ...normalized, from: selector(rule.from === undefined ? {} : rule.from, `${location}.from`, index, id),
        to: selector(rule.to === undefined ? {} : rule.to, `${location}.to`, index, id) });
    }
    for (const key of ['from', 'to']) if (Object.hasOwn(rule, key)) reject(`${location}.${key}`, 'is unsupported for layering', index, id);
    if (!Array.isArray(rule.layers) || !rule.layers.length) reject(`${location}.layers`, 'must be a nonempty layer array', index, id);
    const names = new Set();
    const layers = Array.from(rule.layers, (layer, ordinal) => {
      const location = `rules[${index}].layers[${ordinal}]`;
      record(layer, location, ['name', 'match'], index, id);
      if (typeof layer.name !== 'string' || !layer.name.trim()) reject(`${location}.name`, 'must be a nonempty string', index, id);
      const name = layer.name.trim();
      if (names.has(name)) reject(`${location}.name`, 'must be unique within this layering rule', index, id);
      names.add(name);
      return Object.freeze({ name, match: selector(layer.match === undefined ? {} : layer.match, `${location}.match`, index, id) });
    });
    return Object.freeze({ ...normalized, layers: Object.freeze(layers) });
  });
  return Object.freeze({ version: ARCHITECTURE_RULES_VERSION, rules: Object.freeze(rules) });
};
