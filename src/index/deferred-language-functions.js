/** Keep synchronous language operations synchronous while delaying their module
 * graph until first use. Only literal, repository-owned loaders belong here;
 * load/initialization failures propagate, with no backend or parser fallback.
 */
export const deferLanguageFunctions = (load, names) => {
  let namespace;
  const functions = Object.create(null);
  for (const name of names) {
    let implementation;
    functions[name] = (...args) => {
      if (!implementation) {
        namespace ||= load();
        const selected = namespace[name];
        if (typeof selected !== 'function') throw new TypeError(`Language operation ${name} is not a function.`);
        implementation = selected;
      }
      return Reflect.apply(implementation, undefined, args);
    };
  }
  return Object.freeze(functions);
};
