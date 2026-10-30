/** Read optional diagnostic data without invoking accessors or coercing errors.
 * Unknown/unreadable fields are not classification or resource-settlement proof.
 */
export const readErrorDataProperty = (error, key) => {
  if (error === null || !['object', 'function'].includes(typeof error)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
};
