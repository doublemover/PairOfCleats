/** Store arbitrary string keys as own enumerable data, including __proto__. */
export const setOwn = (record, key, value) => {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
  return value;
};
export const getOwn = (record, key) => Object.hasOwn(record, key) ? record[key] : undefined;
