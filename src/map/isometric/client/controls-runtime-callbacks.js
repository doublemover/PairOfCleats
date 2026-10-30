/** Captured operation callbacks keep their original object receiver. This
 * facade grants no disposal authority over the renderer/camera resource. */
export const captureControlsRuntimeCallbacks = (resource, names, wrap, isCurrent) => {
  const callbacks = {};
  for (const name of names) {
    if (isCurrent() !== true) throw new Error('Controls runtime callback capture lost its original authority.');
    const original = resource[name];
    if (isCurrent() !== true) throw new Error('Controls runtime callback capture lost its original authority.');
    if (typeof original !== 'function') throw new TypeError(`Map controls require original ${name} callback.`);
    callbacks[name] = wrap((...args) => Reflect.apply(original, resource, args));
  }
  return Object.freeze(callbacks);
};
