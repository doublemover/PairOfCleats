import { SEMANTIC_NODE_SCHEMA } from '../../contracts/schemas/semantic.js';
import { validateSemanticRecord } from '../../contracts/validators/semantic.js';
import { throwIfAborted } from '../../shared/abort.js';

const occurrence = SEMANTIC_NODE_SCHEMA.oneOf.find(schema => schema.properties.kind.const === 'occurrence');
const expression = SEMANTIC_NODE_SCHEMA.oneOf.find(schema => schema.properties.kind.const === 'expression');
const roles = new Set(occurrence.properties.data.properties.roles.items.enum);
const invocationKinds = new Set(expression.properties.data.properties.invocationKind.anyOf[0].enum);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
const fields = (value, names) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw fail('LSP target metadata must be a plain object.');
  let count = 0;
  for (const key in value) if (Object.hasOwn(value, key)) {
    if (!names.includes(key) || ++count > names.length) throw fail('LSP target metadata has unknown fields.');
  }
  if (count !== names.length || Object.getOwnPropertySymbols(value).length) throw fail('LSP target metadata has missing or non-JSON fields.');
  const result = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail('LSP target metadata getters are not JSON.');
    result[name] = descriptor.value;
  }
  return result;
};
const copyArray = (value, maximum, copy, check) => {
  if (!Array.isArray(value)) throw fail('LSP target metadata must use dense arrays.');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw fail('LSP target array exceeds its retained source or schema inventory.');
  let count = 0;
  for (const key in value) if (Object.hasOwn(value, key)) {
    check();
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) throw fail('LSP target metadata arrays cannot have extra fields.');
    count++;
  }
  if (count !== length || Object.getOwnPropertySymbols(value).length) throw fail('LSP target metadata arrays must be dense JSON.');
  const result = [];
  for (let index = 0; index < length; index++) {
    check();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail('LSP target metadata getters are not JSON.');
    result.push(copy(descriptor.value));
  }
  return result;
};

/** Copy only the exact retained target surface before the first asynchronous read.
 * Cardinality comes from immutable source occurrences and canonical role enums;
 * source spelling bounds string comparisons without encoding caller metadata.
 * The caller must still prove every copied target against its retained record.
 */
export const captureLspTargetSelection = ({ selection, partitionId, occurrenceCount, text, signal = null }) => {
  const check = () => throwIfAborted(signal);
  check();
  if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount < 0 || typeof text !== 'string'
    || !validateSemanticRecord('recordRef', { partitionId, localId: 0 }).ok) throw fail('A retained source occurrence inventory is required.');
  const copyRef = value => {
    const ref = fields(value, ['partitionId', 'localId']);
    if (ref.partitionId !== partitionId || Object.is(ref.localId, -0)
      || !validateSemanticRecord('recordRef', ref).ok) throw fail('LSP target reference is outside its retained syntax partition.');
    return { partitionId, localId: ref.localId };
  };
  const seen = new Set();
  return copyArray(selection, occurrenceCount, value => {
    const target = fields(value, ['ref', 'invocation', 'span', 'scope', 'roles', 'name']);
    const ref = copyRef(target.ref);
    if (seen.has(ref.localId)) throw fail('LSP target is not a unique retained source occurrence.');
    seen.add(ref.localId);
    const span = copyArray(target.span, 2, offset => {
      if (!Number.isSafeInteger(offset) || Object.is(offset, -0) || offset < 0 || offset > text.length) throw fail('LSP target span exceeds its retained source.');
      return offset;
    }, check);
    if (span.length !== 2 || span[1] < span[0] || typeof target.name !== 'string' || target.name.length !== span[1] - span[0]
      || target.name !== text.slice(span[0], span[1])) throw fail('LSP target spelling differs from its retained source span.');
    const selectedRoles = new Set();
    const copiedRoles = copyArray(target.roles, roles.size, role => {
      if (!roles.has(role) || selectedRoles.has(role)) throw fail('LSP target roles differ from the canonical occurrence schema.');
      selectedRoles.add(role); return role;
    }, check);
    if (!copiedRoles.length || selectedRoles.has('definition')) throw fail('LSP targets require non-definition occurrence roles.');
    let invocation = null;
    if (target.invocation !== null) {
      const item = fields(target.invocation, ['ref', 'kind']);
      if (!invocationKinds.has(item.kind)) throw fail('LSP target invocation kind differs from the canonical expression schema.');
      invocation = { ref: copyRef(item.ref), kind: item.kind };
    }
    return { ref, invocation, span, scope: target.scope === null ? null : copyRef(target.scope), roles: copiedRoles, name: target.name };
  }, check);
};
