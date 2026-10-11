import { assertCompilerTaskAuthority } from './compiler-dependencies.js';
import { assertWasmTaskAuthority } from './wasm/task-authority.js';
/** Authoritative task capability dispatch; binary sources never authorize a Program. */
export const assertSemanticTaskAuthority = (task,target) => {
  assertCompilerTaskAuthority(task,target);
  assertWasmTaskAuthority(task,target);
};
