/** Shared syntactic position accounting. Unknown spread expansion ends fixed
 * positions, while later ordinary arguments still contribute a lower bound.
 * Only a bounded prefix retains parser nodes; original counts are independent.
 */
export const projectArgumentPositions = (nodes, { isSpread, spreadElements, maxSlots = 32 } = {}) => {
  if (!Array.isArray(nodes)) return null;
  const entries = []; let min = 0, max = 0, position = 0, entryCount = 0;
  const retain = (node, operandOrdinal, expansionOrdinal, kind) => {
    entryCount++;
    if (entries.length < maxSlots) entries.push({ node, operandOrdinal, expansionOrdinal,
      runtimeOrdinal: position, kind });
  };
  for (let operandOrdinal = 0; operandOrdinal < nodes.length; operandOrdinal++) {
    const node = nodes[operandOrdinal];
    if (isSpread?.(node)) {
      const elements = spreadElements?.(node);
      if (Array.isArray(elements)) {
        for (let index = 0; index < elements.length; index++) {
          retain(elements[index], operandOrdinal, index, elements[index] ? 'ordinary' : 'hole');
          min++; if (max !== null) max++; if (position !== null) position++;
        }
      } else {
        position = null; max = null; retain(node, operandOrdinal, null, 'spread');
      }
    } else {
      retain(node, operandOrdinal, null, node ? 'ordinary' : 'unknown');
      min++; if (max !== null) max++; if (position !== null) position++;
    }
  }
  return { syntacticArgumentCount: nodes.length, min, max, entries, omittedSlots: entryCount - entries.length };
};
