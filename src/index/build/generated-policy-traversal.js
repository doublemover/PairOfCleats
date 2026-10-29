import picomatch from 'picomatch';

export const GENERATED_INCLUDE_SELECTION_CONTRACT = 'explicit-leaf-and-bounded-ancestor-v1';

/** Conservative ancestor reachability, separate from the authoritative final
 * node-ignore file decision. State is bounded by the selector/path lengths;
 * globstars consume segments without enumerating hypothetical descendants. */
export const compileGeneratedIncludeTraversal = patterns => {
  const selectors = patterns.map(pattern => {
    if (pattern.length > 4096) throw new TypeError('Generated include selector exceeds the bounded path allowance.');
    const parts = pattern.replace(/^\//, '').replace(/\/$/, '').split('/');
    if (parts.length > 256 || parts.some(part => !part || part === '.' || part === '..')) {
      throw new TypeError('Generated include selector requires bounded relative path segments.');
    }
    if (!pattern.includes('/')) parts.unshift('**');
    return parts.map(part => part === '**' ? null : picomatch(part,
      { dot: true, nocase: true, nonegate: true, nobrace: true, noext: true, strictBrackets: true }));
  });
  return relPath => {
    const parts = relPath.split('/');
    if (parts.length > 256) return false;
    return selectors.some(selector => {
      const expand = states => {
        for (let index = 0; index < selector.length; index++) {
          if (states.has(index) && selector[index] === null) states.add(index + 1);
        }
        return states;
      };
      let states = expand(new Set([0]));
      for (const part of parts) {
        if (states.has(selector.length)) return true;
        const next = new Set();
        for (const index of states) {
          const match = selector[index];
          if (match === null) next.add(index);
          else if (match?.(part)) next.add(index + 1);
        }
        states = expand(next);
        if (!states.size) return false;
      }
      return states.size > 0;
    });
  };
};
