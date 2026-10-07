const requirementName = (name) => String(name || '').trim().toLowerCase();

export const resolveInstallerRequirementProbeArgs = (commandName) => {
  const name = requirementName(commandName);
  if (name === 'go') return [['version']];
  if (name === 'dotnet') return [['--info'], ['--version']];
  if (name === 'composer' || name === 'gem') return [['--version']];
  return [['--version'], ['version']];
};

/** Recognize the SDK protocol, rather than another exit-zero executable named go. */
export const verifyInstallerRequirementProbe = (commandName, probe) => {
  if (probe?.ok !== true) return { ok: false, reason: probe?.outcome || 'probe_failed' };
  if (requirementName(commandName) !== 'go') return { ok: true, verificationLevel: 'exit-status' };
  const output = String(probe.stdout || '').trim();
  const release = /^go version (go\d+\.\d+(?:\.\d+)?(?:beta\d+|rc\d+)?) ([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(output);
  const development = /^go version devel [^\r\n]+ ([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(output);
  if (!release && !development) return { ok: false, reason: 'unrecognized_go_sdk_version' };
  return { ok: true, verificationLevel: 'go-sdk-version-output', identity: {
    family: 'go', version: release?.[1] || 'devel',
    platform: release?.[2] || development[1], arch: release?.[3] || development[2]
  } };
};
