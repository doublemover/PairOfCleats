/**
 * Read a balanced delimiter body while delegating comment/string skipping to a
 * language-specific lexical scanner.
 *
 * `advanceIgnoredSpan` may return either `null` or the unchanged index when the
 * current character should be processed by the delimiter reader.
 *
 * @param {string} source
 * @param {number} openIndex
 * @param {{
 *   open?: string,
 *   close?: string,
 *   createState: () => object,
 *   advanceIgnoredSpan: (source:string,index:number,state:object) => (number|null)
 * }} options
 * @returns {{body:string,endIndex:number,closed:boolean}}
 */
export const readBalancedDelimitedBody = (source, openIndex, {
  open = '(',
  close = ')',
  createState,
  advanceIgnoredSpan
}) => {
  let index = openIndex;
  let depth = 0;
  const scanState = createState();
  while (index < source.length) {
    const char = source[index];
    const nextIndex = advanceIgnoredSpan(source, index, scanState);
    if (nextIndex !== null && nextIndex !== index) {
      index = nextIndex;
      continue;
    }
    if (char === open) {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return {
          body: source.slice(openIndex + 1, index - 1),
          endIndex: index,
          closed: true
        };
      }
      continue;
    }
    index += 1;
  }
  return {
    body: source.slice(openIndex + 1),
    endIndex: source.length,
    closed: false
  };
};
