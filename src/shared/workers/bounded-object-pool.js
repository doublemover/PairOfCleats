/**
 * Create a bounded object pool for high-frequency short-lived objects.
 *
 * @template T
 * @param {object} input
 * @param {number} [input.maxSize]
 * @param {() => T} input.create
 * @param {(value:T) => T} [input.reset]
 * @returns {{acquire:() => T,release:(value:T|null|undefined)=>void,stats:()=>{size:number,maxSize:number}}}
 */
export const createBoundedObjectPool = ({
  maxSize = 256,
  create,
  reset = (value) => value
}) => {
  const cap = Number.isFinite(Number(maxSize))
    ? Math.max(1, Math.floor(Number(maxSize)))
    : 256;
  const store = [];
  return {
    acquire() {
      const next = store.pop();
      return next ?? create();
    },
    release(value) {
      if (!value || store.length >= cap) return;
      store.push(reset(value));
    },
    stats() {
      return {
        size: store.length,
        maxSize: cap
      };
    }
  };
};
