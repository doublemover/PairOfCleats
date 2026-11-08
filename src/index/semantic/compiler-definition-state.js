export const definitionBudgetError = () => Object.assign(new Error('Compiler definition-state work budget exhausted.'),
  { code: 'ERR_COMPILER_DEFINITION_BUDGET' });
const charge = (spend, amount) => { if (amount > 0 && !spend(amount)) throw definitionBudgetError(); };
const equalSet = (left, right) => left === right || Boolean(left && right && left.size === right.size && [...right].every(value => left.has(value)));

/** All input states/sets are immutable after publication to a CFG block. */
export const mergeDefinitionStates = (states, { spend = () => true } = {}) => {
  let result = null, owned = false;
  for (const state of states) {
    if (!state) continue;
    if (!result) { result = state; continue; }
    if (result === state) continue;
    charge(spend, state.size);
    for (const [symbol, values] of state) {
      const previous = result.get(symbol);
      if (previous !== values) charge(spend, values.size);
      if (previous === values || previous && [...values].every(value => previous.has(value))) continue;
      if (!owned) { charge(spend, result.size); result = new Map(result); owned = true; }
      if (previous) charge(spend, previous.size + values.size);
      result.set(symbol, previous ? new Set([...previous, ...values]) : values);
    }
  }
  return result || new Map();
};

/** Clone the map only on the first effective transfer. Never mutate an input set. */
export const createDefinitionTransfer = (input, { spend = () => true } = {}) => {
  let output = input, owned = false;
  return {
    get: key => output.get(key),
    set(key, values) {
      charge(spend, values.size);
      if (equalSet(output.get(key), values)) return;
      if (!owned) { charge(spend, input.size); output = new Map(input); owned = true; }
      output.set(key, values);
    },
    finish: () => output
  };
};
export const definitionStatesEqual = (left, right, { spend = () => true } = {}) => {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  charge(spend, right.size);
  for (const [key, values] of right) {
    if (left.get(key) !== values) charge(spend, values.size);
    if (!equalSet(left.get(key), values)) return false;
  }
  return true;
};
