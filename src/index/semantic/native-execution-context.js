const grants = new WeakMap();

/** Only the admitted durable batch creates this capability. CLI/config fields
 * cannot opt an unsealed provider into deferred execution.
 */
export const enterNativeExecution = (state, authority) => {
  const capability = Object.freeze({});
  grants.set(capability, authority);
  state.semanticNativeExecutionGrant = capability;
  return () => {
    grants.delete(capability);
    if (state.semanticNativeExecutionGrant === capability) delete state.semanticNativeExecutionGrant;
  };
};
export const nativeExecutionAuthority = state => grants.get(state.semanticNativeExecutionGrant) || null;
