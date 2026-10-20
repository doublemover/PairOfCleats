const requirementName = (name) => String(name || '').trim().toLowerCase();
const GO_MINIMUM = /^go(\d+)\.(\d+)\.(\d+)$/;

export const isGoSdkVersionAtLeast = (version, minimum) => {
  const actual = /^go(\d+)\.(\d+)(?:\.(\d+))?((?:beta|rc)\d+)?$/.exec(String(version || ''));
  const required = GO_MINIMUM.exec(String(minimum || ''));
  if (!actual || !required) return false;
  const a = [Number(actual[1]), Number(actual[2]), Number(actual[3] || 0)];
  const b = required.slice(1).map(Number);
  if (![...a, ...b].every(Number.isSafeInteger)) return false;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return !actual[4];
};

export const resolveInstallerRequirementProbeArgs = (commandName) => {
  const name = requirementName(commandName);
  if (name === 'go') return [['version']];
  if (name === 'dotnet') return [['--info'], ['--version']];
  if (name === 'composer' || name === 'gem') return [['--version']];
  return [['--version'], ['version']];
};

/** Recognize the SDK protocol, rather than another exit-zero executable named go. */
export const verifyInstallerRequirementProbe = (commandName, probe, { minimumGoVersion = null } = {}) => {
  if (probe?.ok !== true) return { ok: false, reason: probe?.outcome || 'probe_failed' };
  if (requirementName(commandName) !== 'go') return { ok: true, verificationLevel: 'exit-status' };
  const output = String(probe.stdout || '').trim();
  const release = /^go version (go\d+\.\d+(?:\.\d+)?(?:beta\d+|rc\d+)?) ([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(output);
  const development = /^go version devel [^\r\n]+ ([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(output);
  if (!release && !development) return { ok: false, reason: 'unrecognized_go_sdk_version' };
  const identity = {
    family: 'go', version: release?.[1] || 'devel',
    platform: release?.[2] || development[1], arch: release?.[3] || development[2]
  };
  const observed = { verificationLevel: 'go-sdk-version-output', identity };
  if (minimumGoVersion && !GO_MINIMUM.test(minimumGoVersion)) {
    return { ok: false, ...observed, reason: 'invalid_go_sdk_minimum_version' };
  }
  if (minimumGoVersion && !isGoSdkVersionAtLeast(identity.version, minimumGoVersion)) {
    return { ok: false, ...observed, minimumGoVersion, reason: 'unsupported_go_sdk_version' };
  }
  return { ok: true, ...observed };
};
