/** Candidate execution for the supplied Boolean slice, never repository code.
 * The separate checker deliberately does not call these operations or input
 * enumeration helpers. Both are constrained by the admitted finite profile.
 */
export const finiteFeasibilityAssignment = (slice, index) => {
  const bindings = new Map(slice.fixedInputs);
  for (const [bit, id] of slice.freeInputs.entries()) bindings.set(id, Boolean(index & (2 ** bit)));
  return slice.request.inputs.map(input => ({ input, value: bindings.get(input) }));
};
export const interpretFiniteFeasibility = (slice, index) => {
  const values = new Map(finiteFeasibilityAssignment(slice, index).map(row => [row.input, row.value]));
  const trace = []; let blockId = slice.request.entry, predecessor = null, steps = 0;
  const predicate = slice.request.predicate;
  const result = (matches, terminal = null, unknown = null) => ({ matches, terminal, unknown, trace, steps });
  while (blockId !== null) {
    const block = slice.blocks.get(blockId); trace.push(blockId); steps++;
    if (predicate.kind === 'reaches-block' && predicate.block === blockId) return result(true);
    const phiValues = block.phis.map(phi => [phi.id, values.get(phi.incoming.find(row => row.predecessor === predecessor).value)]);
    steps += block.phis.length;
    for (const [id, value] of phiValues) values.set(id, value);
    for (const instruction of block.operations) {
      steps++; let value;
      switch (instruction.kind) {
        case 'constant': value = instruction.value; break;
        case 'copy': value = values.get(instruction.operand); break;
        case 'not': value = !values.get(instruction.operand); break;
        case 'and': value = values.get(instruction.left) && values.get(instruction.right); break;
        case 'or': value = values.get(instruction.left) || values.get(instruction.right); break;
        case 'xor': value = values.get(instruction.left) !== values.get(instruction.right); break;
        case 'equal': value = values.get(instruction.left) === values.get(instruction.right); break;
        case 'unsupported': return result(null, null, instruction.reason);
        default: throw new TypeError('Unadmitted finite feasibility operation.');
      }
      if (typeof value !== 'boolean') throw new TypeError('Admitted SSA operand has no Boolean value.');
      values.set(instruction.id, value);
    }
    const terminal = block.terminator; steps++;
    if (terminal.kind === 'unsupported') return result(null, null, terminal.reason);
    if (['return', 'throw'].includes(terminal.kind)) {
      const value = values.get(terminal.value);
      return result(predicate.block === blockId && predicate.kind === terminal.kind + '-value' && predicate.value === value,
        { kind: terminal.kind, value });
    }
    predecessor = blockId;
    blockId = terminal.kind === 'goto' ? terminal.target : values.get(terminal.condition) ? terminal.onTrue : terminal.onFalse;
  }
  throw new TypeError('Admitted slice did not terminate.');
};
