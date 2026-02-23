/**
 * Resolve scheduler token envelope for eager prefetch scheduling.
 *
 * @param {{
 *   estimatedBytes:number,
 *   laneHint:string,
 *   massiveWriteIoTokens:number,
 *   massiveWriteMemTokens:number,
 *   resolveArtifactWriteMemTokens:(estimatedBytes:number)=>number
 * }} input
 * @returns {{io:number,mem?:number}}
 */
export const resolveEagerWriteSchedulerTokens = ({
  estimatedBytes,
  laneHint,
  massiveWriteIoTokens,
  massiveWriteMemTokens,
  resolveArtifactWriteMemTokens
}) => {
  const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
  if (laneHint === 'massive') {
    const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
    return massiveMem > 0
      ? { io: massiveWriteIoTokens, mem: massiveMem }
      : { io: massiveWriteIoTokens };
  }
  return memTokens > 0 ? { io: 1, mem: memTokens } : { io: 1 };
};

/**
 * Resolve scheduler io/mem tokens for one dispatch write unit.
 *
 * @param {{
 *   estimatedBytes:number,
 *   laneName:string,
 *   rescueBoost?:boolean,
 *   massiveWriteIoTokens:number,
 *   massiveWriteMemTokens:number,
 *   writeTailRescueBoostIoTokens:number,
 *   writeTailRescueBoostMemTokens:number,
 *   resolveArtifactWriteMemTokens:(estimatedBytes:number)=>number
 * }} input
 * @returns {{io:number,mem?:number}}
 */
export const resolveDispatchWriteSchedulerTokens = ({
  estimatedBytes,
  laneName,
  rescueBoost = false,
  massiveWriteIoTokens,
  massiveWriteMemTokens,
  writeTailRescueBoostIoTokens,
  writeTailRescueBoostMemTokens,
  resolveArtifactWriteMemTokens
}) => {
  const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
  if (laneName === 'massive') {
    const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
    const ioTokens = massiveWriteIoTokens + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
    const memBudget = massiveMem + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
    return memBudget > 0
      ? { io: ioTokens, mem: memBudget }
      : { io: ioTokens };
  }
  const ioTokens = 1 + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
  const memBudget = memTokens + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
  return memBudget > 0 ? { io: ioTokens, mem: memBudget } : { io: ioTokens };
};
