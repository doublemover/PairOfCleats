import { projectArgumentPositions } from '../../shared/argument-positions.js';
import { CALL_ARGUMENTS_VERSION, MAX_CALL_ARGUMENT_SLOTS, unavailableCallArguments } from '../../contracts/call-arguments.js';
import { projectJsTsLiteral } from './literal.js';

export const projectJsTsCallArguments = (nodes, text, language = 'javascript') => {
  const positions = projectArgumentPositions(nodes, { maxSlots: MAX_CALL_ARGUMENT_SLOTS,
    isSpread: node => node?.type === 'SpreadElement',
    spreadElements: node => node.argument?.type === 'ArrayExpression' && node.argument.elements.length <= 256
      && !node.argument.elements.some(value => value?.type === 'SpreadElement') ? node.argument.elements : null });
  if (!positions) return unavailableCallArguments(language);
  const slots = positions.entries.map(({ node, ...position }) => {
    const valid = node && Number.isSafeInteger(node.start) && Number.isSafeInteger(node.end)
      && node.start >= 0 && node.end >= node.start && node.end <= text.length;
    const range = valid ? { start: node.start, end: node.end } : null;
    const preview = valid ? text.slice(node.start, Math.min(node.end, node.start + 80)) : position.kind === 'hole' ? 'undefined' : '';
    const literal = projectJsTsLiteral(node, text);
    return { ...position, range, preview, previewTruncated: !valid && position.kind !== 'hole' || valid && node.end - node.start > 80,
      literalType: position.kind === 'hole' ? 'undefined' : literal?.kind || null };
  });
  const complete = positions.max !== null && !positions.omittedSlots
    && slots.every(slot => !slot.previewTruncated && !['spread', 'unknown'].includes(slot.kind));
  return { version: CALL_ARGUMENTS_VERSION, source: 'parser-node', language,
    syntacticArgumentCount: positions.syntacticArgumentCount, arity: {
      state: positions.max === positions.min ? 'exact' : 'bounded', min: positions.min, max: positions.max },
    slotCoverage: complete ? 'complete' : 'partial', omittedSlots: positions.omittedSlots, slots };
};
