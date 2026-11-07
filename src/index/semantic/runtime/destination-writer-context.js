const active = new WeakMap();
export const assertRuntimeDestinationWriter = (destination, account) => {
  if (active.get(account) !== destination) throw new TypeError('Runtime catalog mutation requires its active destination writer account.');
};
export const withRuntimeDestinationAccount = async (destination, account, operation) => {
  if (active.has(account)) throw new TypeError('Runtime destination account already has an active mutation.');
  active.set(account, destination);
  try { return await operation(); } finally { active.delete(account); }
};
