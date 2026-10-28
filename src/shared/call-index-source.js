const sources = new WeakMap();

/** A live call index may lend its original arrays to a compact file projection.
 * Serialized or copied indexes cannot acquire that source relationship. */
export const ownCallIndexSource = (index, source) => {
  sources.set(index, source);
  return index;
};
export const getCallIndexSource = index => sources.get(index);
