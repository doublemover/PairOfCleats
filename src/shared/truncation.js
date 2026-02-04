/**
 * Create a truncation recorder that deduplicates entries by scope+cap.
 * @param {{scope?:string,target?:Array<object>}} [options]
 * @returns {{list:Array<object>,record:(cap:string,detail?:object)=>void,seen:Set<string>}}
 */
export const createTruncationRecorder = ({ scope, target } = {}) => {
  const list = Array.isArray(target) ? target : [];
  const seen = new Set();
  const record = (cap, detail = {}) => {
    const key = `${scope || 'truncation'}:${cap}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      scope: scope || 'truncation',
      cap,
      ...detail
    });
  };
  return { list, record, seen };
};
