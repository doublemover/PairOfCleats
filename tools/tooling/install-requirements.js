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
  if (name === 'dotnet') return [['--list-sdks']];
  if (name === 'php') return [['-r', 'echo json_encode(["family"=>"php","version"=>PHP_VERSION,"binary"=>PHP_BINARY,"extensions"=>get_loaded_extensions()]);']];
  if (name === 'ruby') return [['-rjson', '-e', 'puts JSON.generate({family: "ruby", version: RUBY_VERSION, executable: RbConfig.ruby})']];
  if (name === 'python' || name === 'python3') return [['-c', 'import json,sys; print(json.dumps({"family":"python","version":sys.version.split()[0],"executable":sys.executable}))']];
  if (name === 'java' || name === 'javac') return [['-version']];
  if (name === 'rustup') return [['show', 'active-toolchain']];
  if (name === 'composer' || name === 'gem') return [['--version']];
  return [['--version'], ['version']];
};

/** Recognize the SDK protocol, rather than another exit-zero executable named go. */
export const verifyInstallerRequirementProbe = (commandName, probe, { minimumGoVersion = null, requiredComponents = [] } = {}) => {
  if (probe?.ok !== true) return { ok: false, reason: probe?.outcome || 'probe_failed' };
  const name = requirementName(commandName);
  if (name !== 'go') {
    const output = `${probe.stdout || ''}\n${probe.stderr || ''}`.trim();
    let identity = null;
    if (['php', 'ruby', 'python', 'python3'].includes(name)) {
      try {
        const value = JSON.parse(String(probe.stdout || '').trim());
        if (value.family === (name === 'python3' ? 'python' : name) && /^\d+\.\d+/.test(value.version)
          && typeof (value.executable || value.binary) === 'string') identity = value;
      } catch { /* A name and successful exit alone are not runtime identity. */ }
    } else if (name === 'dotnet') {
      const sdks = output.split(/\r?\n/).map(line => /^(\d+\.\d+\.\d+(?:-[\w.-]+)?) \[([^\]]+)\]$/.exec(line)).filter(Boolean);
      if (sdks.length) identity = { family: 'dotnet-sdk', version: sdks.at(-1)[1], sdks: sdks.map(match => ({ version: match[1], path: match[2] })) };
    } else {
      const patterns = {
        npm: /^(\d+\.\d+\.\d+)$/,
        node: /^v(\d+\.\d+\.\d+)$/,
        gem: /^(\d+\.\d+\.\d+)$/,
        composer: /^Composer version (\d+\.\d+\.\d+)\b/,
        cargo: /^cargo (\d+\.\d+\.\d+)\b/,
        rustc: /^rustc (\d+\.\d+\.\d+)\b/,
        rustup: /^(\S*(?:stable|\d+\.\d+\.\d+)[\w.-]*)(?:\s|$)/,
        java: /(?:openjdk|java) version "(\d+(?:\.\d+)*)(?:[^"\r\n]*)"/,
        javac: /^javac (\d+(?:\.\d+)*)/,
        mix: /Mix (\d+\.\d+\.\d+)/,
        elixir: /Elixir (\d+\.\d+\.\d+)/,
        ghc: /Glasgow Haskell Compilation System, version (\d+\.\d+\.\d+)/,
        cabal: /cabal-install version (\d+(?:\.\d+)+)/,
        stack: /(?:Version|stack) (\d+\.\d+\.\d+)/,
        dart: /Dart SDK version: (\d+\.\d+\.\d+)/,
        zig: /^(\d+\.\d+\.\d+)$/
      };
      const match = patterns[name]?.exec(output);
      if (match) identity = { family: name, version: match[1] };
    }
    if (!identity) return { ok: false, reason: `unrecognized_${name || 'runtime'}_identity` };
    const missing = requiredComponents.filter(component => !Array.isArray(identity.extensions)
      || !identity.extensions.map(value => value.toLowerCase()).includes(component.toLowerCase()));
    if (missing.length) return { ok: false, identity, reason: 'missing_runtime_components', missingComponents: missing };
    return { ok: true, identity, verificationLevel: 'recognized-runtime-identity' };
  }
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
