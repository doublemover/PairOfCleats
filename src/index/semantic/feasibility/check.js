// Independent finite replay: numeric truth tables and a separate control walk.
// This module imports neither the producer interpreter nor its bit assignment.
const tables = Object.freeze({ and: [0, 0, 0, 1], or: [0, 1, 1, 1], xor: [0, 1, 1, 0], equal: [1, 0, 0, 1] });
export const checkFiniteFeasibilityAssignment = (request, assignmentIndex) => {
  const cells = new Map(request.entryConditions.map(row => [row.input, row.value ? 1 : 0]));
  let remaining = assignmentIndex;
  for (const input of request.inputs) if (!cells.has(input)) { cells.set(input, remaining % 2); remaining = Math.floor(remaining / 2); }
  const input = request.inputs.map(id => ({ input: id, value: cells.get(id) === 1 }));
  const trace = []; let current = request.entry, previous = null, steps = 0;
  const output = (matches, terminal = null, unknown = null) => ({ matches, terminal, unknown, input, trace, steps });
  for (let visit = 0; visit < request.blocks.length; visit++) {
    const block = request.blocks.find(row => row.id === current);
    if (!block) throw new TypeError('Checker encountered an unadmitted block.');
    trace.push(current); steps++;
    if (request.predicate.kind === 'reaches-block' && request.predicate.block === current) return output(true);
    const simultaneous = [];
    for (const phi of block.phis) {
      steps++;
      const incoming = phi.incoming.filter(row => row.predecessor === previous);
      if (incoming.length !== 1 || !cells.has(incoming[0].value)) throw new TypeError('Checker phi is not defined on this predecessor.');
      simultaneous.push([phi.id, cells.get(incoming[0].value)]);
    }
    for (const [id, bit] of simultaneous) cells.set(id, bit);
    for (const instruction of block.operations) {
      steps++; let bit;
      if (instruction.kind === 'unsupported') return output(null, null, instruction.reason);
      if (instruction.kind === 'constant') bit = Number(instruction.value);
      else if (instruction.kind === 'copy') bit = cells.get(instruction.operand);
      else if (instruction.kind === 'not') bit = 1 - cells.get(instruction.operand);
      else if (Object.hasOwn(tables, instruction.kind)) {
        if (!cells.has(instruction.left) || !cells.has(instruction.right)) throw new TypeError('Checker operand missing.');
        bit = tables[instruction.kind][cells.get(instruction.left) * 2 + cells.get(instruction.right)];
      } else throw new TypeError('Unsupported checker operation.');
      if (bit !== 0 && bit !== 1) throw new TypeError('Checker value is outside the Boolean profile.');
      cells.set(instruction.id, bit);
    }
    const end = block.terminator; steps++;
    if (end.kind === 'unsupported') return output(null, null, end.reason);
    if (end.kind === 'return' || end.kind === 'throw') {
      if (!cells.has(end.value)) throw new TypeError('Checker terminal value missing.');
      const value = cells.get(end.value) === 1;
      const matches = request.predicate.block === current && request.predicate.kind === end.kind + '-value' && request.predicate.value === value;
      return output(matches, { kind: end.kind, value });
    }
    previous = current;
    if (end.kind === 'goto') current = end.target;
    else {
      if (!cells.has(end.condition)) throw new TypeError('Checker guard missing.');
      current = cells.get(end.condition) === 1 ? end.onTrue : end.onFalse;
    }
  }
  throw new TypeError('Independent checker exceeded the acyclic block universe.');
};
