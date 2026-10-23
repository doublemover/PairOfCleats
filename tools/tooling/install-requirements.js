import semver from 'semver';
import fs from 'node:fs';

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
  if (name === 'dotnet-runtime') return [['--list-runtimes']];
  if (name === 'php') return [['-r', 'echo json_encode(["family"=>"php","version"=>PHP_VERSION,"binary"=>PHP_BINARY,"extensions"=>get_loaded_extensions()]);']];
  if (name === 'ruby') return [['-rjson', '-rrbconfig', '-rrubygems', '-e', 'puts JSON.generate({family: "ruby", version: RUBY_VERSION, executable: RbConfig.ruby, components: Gem::Specification.find_all_by_name("bundler").empty? ? [] : ["bundler"]})']];
  if (name === 'python' || name === 'python3') return [['-c', 'import importlib.util,json,sys; print(json.dumps({"family":"python","version":sys.version.split()[0],"executable":sys.executable,"components":[name for name in ("venv","ensurepip","pip") if importlib.util.find_spec(name) is not None]}))']];
  if (name === 'java' || name === 'javac') return [['-version']];
  if (name === 'rustup') return [['show', 'active-toolchain']];
  if (name === 'composer' || name === 'gem') return [['--version']];
  return [['--version'], ['version']];
};

/** Recognize the SDK protocol, rather than another exit-zero executable named go. */
export const verifyInstallerRequirementProbe = (commandName, probe, { minimumGoVersion = null, requiredComponents = [], versionRange = null, selectedExecutable = null } = {}) => {
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
      if (sdks.length) {
        const versions = sdks.map(match => match[1]).filter(version => semver.valid(version));
        const selected = versionRange && semver.validRange(versionRange) ? semver.maxSatisfying(versions, versionRange) : null;
        identity = { family: 'dotnet-sdk', version: selected || semver.rsort(versions)[0], sdks: sdks.map(match => ({ version: match[1], path: match[2] })) };
      }
    } else if (name === 'dotnet-runtime') {
      const runtimes = output.split(/\r?\n/).map(line => /^(Microsoft\.[A-Za-z.]+) (\d+\.\d+\.\d+(?:-[\w.-]+)?) \[([^\]]+)\]$/.exec(line)).filter(Boolean)
        .map(match => ({ component: match[1], version: match[2], path: match[3] })).filter(runtime => semver.valid(runtime.version));
      const component = requiredComponents[0] || 'Microsoft.NETCore.App';
      const versions = runtimes.filter(runtime => runtime.component === component).map(runtime => runtime.version);
      if (versions.length) identity = { family: 'dotnet-runtime', version: versionRange && semver.validRange(versionRange)
        ? semver.maxSatisfying(versions, versionRange) || semver.rsort(versions)[0] : semver.rsort(versions)[0], runtimes };
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
    if (selectedExecutable && ['php', 'ruby', 'python', 'python3'].includes(name)) {
      let reported;
      try { reported = fs.realpathSync(identity.executable || identity.binary); }
      catch { return { ok: false, identity, reason: 'reported_runtime_executable_unavailable' }; }
      const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
      if (normalize(reported) !== normalize(selectedExecutable.path)) return { ok: false, identity, reason: 'reported_runtime_executable_mismatch' };
    }
    if (name === 'rustup' && !versionRange && !requiredComponents.length) return { ok: true, identity, verificationLevel: 'recognized-runtime-identity' };
    // Java 8 spells its major as 1.8, while modern Java versions may omit
    // minor/patch. Other runtime protocols above report complete versions.
    const normalizedVersion = ['java', 'javac', 'cabal'].includes(name) ? semver.coerce(identity.version)?.version : identity.version;
    const version = ['java', 'javac'].includes(name) && normalizedVersion?.startsWith('1.')
      ? `${semver.minor(normalizedVersion)}.0.0` : normalizedVersion;
    if (!semver.valid(version)) return { ok: false, identity, reason: 'invalid_runtime_version' };
    if (versionRange && !semver.validRange(versionRange)) return { ok: false, identity, reason: 'invalid_runtime_version_constraint' };
    if (versionRange && !semver.satisfies(version, versionRange)) return { ok: false, identity, versionRange, reason: 'unsupported_runtime_version' };
    const reportedComponents = [...(Array.isArray(identity.extensions) ? identity.extensions : []),
      ...(Array.isArray(identity.components) ? identity.components : [])].filter(value => typeof value === 'string').map(value => value.toLowerCase());
    const missing = requiredComponents.filter(component => name === 'dotnet-runtime'
      ? !identity.runtimes.some(runtime => runtime.component === component && (!versionRange || semver.satisfies(runtime.version, versionRange)))
      : !reportedComponents.includes(component.toLowerCase()));
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
