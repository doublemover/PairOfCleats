import { types } from 'node:util';
import { canonicalSemanticJson } from '../identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';

/** Capture passive containers while retaining original opaque view handles. */
export const finiteViewFields = (value, required, optional, fail) => {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length) throw fail('Passive own finite-view input fields required.');
  const names = Object.getOwnPropertyNames(value);
  if (required.some(name => !names.includes(name)) || names.some(name => ![...required, ...optional].includes(name))) throw fail('Unknown or missing finite-view input field.');
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail('Finite-view input accessors/decorations are unavailable.');
    return [name, descriptor.value];
  }));
};

export const captureFiniteViewDefinition = (value, schema, fail) => captureSemanticRequest(
  finiteViewFields(value, schema.required, Object.keys(schema.properties).filter(name => !schema.required.includes(name)), fail), schema);

export const captureFiniteViewJson = (value, maxBytes, fail) => JSON.parse(canonicalSemanticJson(value, { maxBytes,
  onObjectEncoded(original) {
    if (Object.getOwnPropertyNames(original).length !== Object.keys(original).length + (Array.isArray(original) ? 1 : 0)) {
      throw fail('Hidden finite-view batch decorations are unavailable.');
    }
  } }));
