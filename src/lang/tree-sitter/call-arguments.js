import { projectArgumentPositions } from '../../shared/argument-positions.js';
import { CALL_ARGUMENTS_VERSION, MAX_CALL_ARGUMENT_SLOTS, unavailableCallArguments } from '../../contracts/call-arguments.js';
import { getNamedChild, getNamedChildCount } from './ast.js';

/** Only these grammars' explicit argument-list nodes establish runtime count.
 * Unavailable syntax is distinct from an observed empty list.
 */
export const projectNativeCallArguments = (node, text, language) => {
  if (!['rust', 'cpp', 'clike', 'c'].includes(language)) return unavailableCallArguments(language);
  let list = node.childForFieldName?.('arguments');
  if (!list) for (let index = 0; index < getNamedChildCount(node); index++) {
    const child = getNamedChild(node, index);
    if (['arguments', 'argument_list'].includes(child?.type)) { list = child; break; }
  }
  if (!list || list.hasError || getNamedChildCount(list) > 4096) return unavailableCallArguments(language);
  const nodes = [];
  for (let index = 0; index < getNamedChildCount(list); index++) {
    const child = getNamedChild(list, index);
    if (!['comment', 'line_comment', 'block_comment'].includes(child?.type)) nodes.push(child);
  }
  const positions = projectArgumentPositions(nodes, { maxSlots: MAX_CALL_ARGUMENT_SLOTS,
    isSpread: value => ['pack_expansion', 'parameter_pack_expansion'].includes(value?.type) });
  const slots = positions.entries.map(({ node: argument, ...position }) => {
    const start = argument?.startIndex, end = argument?.endIndex;
    const valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= list.startIndex
      && end >= start && end <= list.endIndex && end <= text.length;
    return { ...position, range: valid ? { start, end } : null,
      preview: valid ? text.slice(start, Math.min(end, start + 80)) : '',
      previewTruncated: !valid || end - start > 80, literalType: null };
  });
  for (const slot of slots) { if (slot.range) Object.freeze(slot.range); Object.freeze(slot); }
  return Object.freeze({ version: CALL_ARGUMENTS_VERSION, source: 'parser-node', language,
    syntacticArgumentCount: positions.syntacticArgumentCount,
    arity: Object.freeze({ state: positions.max === positions.min ? 'exact' : 'bounded', min: positions.min, max: positions.max }),
    slotCoverage: positions.max !== null && !positions.omittedSlots && slots.every(slot => !slot.previewTruncated) ? 'complete' : 'partial',
    omittedSlots: positions.omittedSlots, slots: Object.freeze(slots) });
};
