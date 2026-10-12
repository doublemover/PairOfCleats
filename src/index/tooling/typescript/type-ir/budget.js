import { throwIfAborted } from '../../../../shared/abort.js';
import { ToolingRequiredComputationError } from '../../required-computation.js';
import { constants as bufferConstants } from 'node:buffer';
import { performance } from 'node:perf_hooks';

const SHARED_BUDGET = Symbol('type-ir-operation-budget');
export const shareTypeIrBudget = (options, budget) => ({ ...options, [SHARED_BUDGET]: budget });

export const TYPE_IR_DEFAULT_BUDGET = Object.freeze({
  maxSteps: 5000000,
  maxAllocationBytes: 64 * 1024 * 1024,
  maxStates: 100000,
  maxInputChars: 1000000
});

export const invalidTypeIr = (reason) => Object.assign(new TypeError(`Invalid finite-string type IR: ${reason}`), {
  code: 'ERR_TYPE_IR_INVALID', reason
});

export const createTypeIrBudget = (options = {}, operation = 'type-ir') => {
  if (options[SHARED_BUDGET]) { options[SHARED_BUDGET].check(); return options[SHARED_BUDGET]; }
  const limits = { ...TYPE_IR_DEFAULT_BUDGET, ...(options.budget || {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(TYPE_IR_DEFAULT_BUDGET, key) || !Number.isSafeInteger(value) || value < 0) {
      throw invalidTypeIr(`invalid budget ${key}`);
    }
  }
  const deadlineAtMs = options.deadlineAtMs;
  if (deadlineAtMs !== undefined && (!Number.isFinite(deadlineAtMs) || deadlineAtMs < 0)) {
    throw invalidTypeIr('invalid deadlineAtMs');
  }
  const used = { steps: 0, allocationBytes: 0, states: 0 };
  const fail = (reason, detail = {}) => {
    throw new ToolingRequiredComputationError(`Finite-string type IR computation incomplete: ${reason}`, {
      operation, reason, details: { coverage: 'incomplete', ...detail, used: { ...used }, limits: { ...limits } }
    });
  };
  const check = () => {
    throwIfAborted(options.signal);
    if (deadlineAtMs !== undefined && performance.now() >= deadlineAtMs) fail('deadline_exceeded', { deadlineAtMs });
  };
  const charge = (kind, amount, limit) => {
    check();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > limits[limit] - used[kind]) {
      fail(`${limit}_exceeded`, { requested: amount });
    }
    used[kind] += amount;
  };
  check();
  return {
    check,
    fail,
    step: (amount = 1) => charge('steps', amount, 'maxSteps'),
    allocate: (bytes) => charge('allocationBytes', bytes, 'maxAllocationBytes'),
    state: () => charge('states', 1, 'maxStates'),
    input: (text) => {
      check();
      if (text.length > limits.maxInputChars) fail('maxInputChars_exceeded', { requested: text.length });
    },
    stringLength: (length) => {
      check();
      if (!Number.isSafeInteger(length) || length < 0 || length > bufferConstants.MAX_STRING_LENGTH) {
        fail('runtime_string_length_exceeded', { requested: length });
      }
    },
    snapshot: () => ({ ...used })
  };
};

/** Iterative, sharing-preserving postorder over arena-owned acyclic nodes. */
export const typeIrPostorderRoots = (roots, budget) => {
  const seen = new Set();
  const order = [];
  budget.allocate(128 + roots.length * 64);
  const stack = roots.map(node => ({ node, exit: false }));
  while (stack.length) {
    budget.step();
    const { node, exit } = stack.pop();
    if (exit) { order.push(node); continue; }
    if (seen.has(node)) continue;
    budget.state();
    budget.allocate(128 + (node.children?.length || 0) * 64);
    seen.add(node);
    stack.push({ node, exit: true });
    const children = node.children || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      budget.step();
      if (!seen.has(children[index])) stack.push({ node: children[index], exit: false });
    }
  }
  return order;
};

export const typeIrPostorder = (root, budget) => typeIrPostorderRoots([root], budget);
