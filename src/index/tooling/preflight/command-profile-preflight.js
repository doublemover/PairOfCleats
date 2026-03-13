import {
  isProbeCommandDefinitelyMissing,
  resolveToolingCommandProfile
} from '../command-resolver.js';

const normalizeCheck = (value) => (
  value && typeof value === 'object'
    ? value
    : null
);

const resolveCheckDedupeKey = (check) => (
  `${String(check?.name || '').trim().toLowerCase()}`
  + `|${String(check?.status || '').trim().toLowerCase()}`
  + `|${String(check?.message || '').trim()}`
);

const resolveUnavailableMessage = ({
  unavailableMessage,
  check,
  requestedCommand,
  commandProfile,
  definitelyMissing,
  providerId
}) => {
  if (typeof unavailableMessage === 'function') {
    const value = unavailableMessage({
      providerId,
      requestedCommand,
      commandProfile,
      definitelyMissing
    });
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (typeof unavailableMessage === 'string' && unavailableMessage.trim()) {
    return unavailableMessage.trim();
  }
  if (typeof check?.message === 'string' && check.message.trim()) {
    return check.message.trim();
  }
  return `${requestedCommand.cmd} command probe failed for ${providerId}; attempting stdio initialization anyway.`;
};

/**
 * Resolve a command profile for provider preflight and normalize degraded/blocked
 * results when command probing fails.
 *
 * @param {{
 *   providerId:string,
 *   requestedCommand:{cmd:string,args?:string[]},
 *   ctx?:object,
 *   unavailableCheck?:object | ((input:{
 *     providerId:string,
 *     requestedCommand:{cmd:string,args:string[]},
 *     commandProfile:object,
 *     definitelyMissing:boolean,
 *     message:string
 *   }) => object | null),
 *   unavailableMessage?:string | ((input:{
 *     providerId:string,
 *     requestedCommand:{cmd:string,args:string[]},
 *     commandProfile:object,
 *     definitelyMissing:boolean
 *   }) => string),
 *   blockWhenDefinitelyMissing?:boolean,
 *   blockFlag?:string
 * }} input
 * @returns {{
 *   state:'ready'|'degraded'|'blocked',
 *   reasonCode:string|null,
 *   message:string,
 *   requestedCommand:{cmd:string,args:string[]},
 *   commandProfile:object,
 *   definitelyMissing?:boolean,
 *   check?:object,
 *   checks?:object[],
 *   [k:string]:unknown
 * }}
 */
export const resolveCommandProfilePreflightResult = ({
  providerId,
  requestedCommand,
  ctx = null,
  unavailableCheck = null,
  unavailableMessage = null,
  blockWhenDefinitelyMissing = false,
  blockFlag = 'blockProvider'
} = {}) => {
  const command = requestedCommand && typeof requestedCommand === 'object'
    ? requestedCommand
    : { cmd: '', args: [] };
  const normalizedRequested = {
    cmd: String(command.cmd || '').trim(),
    args: Array.isArray(command.args) ? command.args : []
  };
  const commandProfile = resolveToolingCommandProfile({
    providerId: String(providerId || ''),
    cmd: normalizedRequested.cmd,
    args: normalizedRequested.args,
    repoRoot: ctx?.repoRoot || process.cwd(),
    toolingConfig: ctx?.toolingConfig || {}
  });
  if (commandProfile.probe.ok) {
    return {
      state: 'ready',
      reasonCode: null,
      message: '',
      requestedCommand: normalizedRequested,
      commandProfile
    };
  }
  const definitelyMissing = isProbeCommandDefinitelyMissing(commandProfile.probe);
  const rawCheck = typeof unavailableCheck === 'function'
    ? unavailableCheck({
      providerId: String(providerId || ''),
      requestedCommand: normalizedRequested,
      commandProfile,
      definitelyMissing
    })
    : unavailableCheck;
  const check = normalizeCheck(rawCheck);
  const message = resolveUnavailableMessage({
    unavailableMessage,
    check,
    requestedCommand: normalizedRequested,
    commandProfile,
    definitelyMissing,
    providerId: String(providerId || '')
  });
  const blocked = blockWhenDefinitelyMissing === true && definitelyMissing;
  return {
    state: blocked ? 'blocked' : 'degraded',
    reasonCode: 'preflight_command_unavailable',
    message,
    requestedCommand: normalizedRequested,
    commandProfile,
    definitelyMissing,
    ...(blocked ? { [String(blockFlag || 'blockProvider')]: true } : {}),
    ...(check ? { check, checks: [check] } : {})
  };
};

/**
 * Resolve runtime command inputs from preflight output without re-probing.
 *
 * @param {{
 *   preflight?: object | null,
 *   fallbackRequestedCommand?: {cmd?:string,args?:string[]} | null,
 *   missingProfileCheck?: object | null
 * }} input
 * @returns {{
 *   requestedCommand:{cmd:string,args:string[]},
 *   commandProfile:object|null,
 *   cmd:string,
 *   args:string[],
 *   probeKnown:boolean,
 *   probeOk:boolean,
 *   checks:object[]
 * }}
 */
export const resolveRuntimeCommandFromPreflight = ({
  preflight = null,
  fallbackRequestedCommand = null,
  missingProfileCheck = null
} = {}) => {
  const requestedCommand = preflight?.requestedCommand && typeof preflight.requestedCommand === 'object'
    ? {
      cmd: String(preflight.requestedCommand.cmd || '').trim(),
      args: Array.isArray(preflight.requestedCommand.args) ? preflight.requestedCommand.args : []
    }
    : {
      cmd: String(fallbackRequestedCommand?.cmd || '').trim(),
      args: Array.isArray(fallbackRequestedCommand?.args) ? fallbackRequestedCommand.args : []
    };
  const commandProfile = preflight?.commandProfile && typeof preflight.commandProfile === 'object'
    ? preflight.commandProfile
    : null;
  const cmd = String(commandProfile?.resolved?.cmd || requestedCommand.cmd || '').trim();
  const args = Array.isArray(commandProfile?.resolved?.args)
    ? commandProfile.resolved.args
    : requestedCommand.args;
  const checks = [];
  if (!cmd && missingProfileCheck && typeof missingProfileCheck === 'object') {
    checks.push(missingProfileCheck);
  }
  const probeKnown = typeof commandProfile?.probe?.ok === 'boolean';
  return {
    requestedCommand,
    commandProfile,
    cmd,
    args,
    probeKnown,
    probeOk: commandProfile?.probe?.ok === true,
    checks
  };
};

/**
 * Merge preflight/diagnostic checks into a deduplicated array.
 *
 * @param {...(object|object[]|null|undefined)} groups
 * @returns {object[]}
 */
export const mergePreflightChecks = (...groups) => {
  const out = [];
  const seen = new Set();
  const pushCheck = (check) => {
    if (!check || typeof check !== 'object') return;
    const key = resolveCheckDedupeKey(check);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(check);
  };
  for (const group of groups) {
    if (Array.isArray(group)) {
      for (const entry of group) pushCheck(entry);
      continue;
    }
    pushCheck(group);
  }
  return out;
};
