/** Follow actual error edges, including preserved falsey causes, without
 * treating an absent cause as an undefined failure. Cycles remain bounded.
 */
export const errorGraphSome = (failure, predicate) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    if (predicate(value)) return true;
    if (value === null || !['object', 'function'].includes(typeof value)) continue;
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};

export const errorGraphIncludes = (failure, expected) => errorGraphSome(failure, value => Object.is(value, expected));

export const errorGraphMatches = (failure, pattern) => errorGraphSome(failure, value => (
  value instanceof Error && typeof value.message === 'string' && pattern.test(value.message)
));
