export const MANIFEST_FILENAMES = Object.freeze([
  '.pairofcleats.json',
  'build',
  'build.gradle',
  'build.gradle.kts',
  'buf.gen.yaml',
  'buf.yaml',
  'bunfig.toml',
  'cargo.toml',
  'cmakelists.txt',
  'composer.json',
  'deno.json',
  'deno.jsonc',
  'description',
  'directory.build.props',
  'directory.build.targets',
  'dockerfile',
  'flake.nix',
  'gemfile',
  'go.mod',
  'lerna.json',
  'makefile',
  'manifest.toml',
  'mix.exs',
  'package.json',
  'package.swift',
  'packages.config',
  'pipfile',
  'pnpm-workspace.yaml',
  'pom.xml',
  'project.toml',
  'pubspec.yaml',
  'pyproject.toml',
  'requirements-dev.txt',
  'requirements.in',
  'requirements.txt',
  'setup.cfg',
  'setup.py',
  'settings.gradle',
  'settings.gradle.kts',
  'uv.toml',
  'workspace'
]);

export const MANIFEST_SUFFIXES = Object.freeze([
  '.csproj',
  '.projitems',
  '.props',
  '.sln',
  '.targets'
]);

export const LOCK_FILENAMES = Object.freeze([
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'conan.lock',
  'deno.lock',
  'gemfile.lock',
  'go.sum',
  'gradle.lockfile',
  'mix.lock',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.resolved',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'podfile.lock',
  'pubspec.lock',
  'requirements.lock',
  'uv.lock',
  'yarn.lock'
]);

export const SPECIAL_CODE_FILENAME_TO_EXT = Object.freeze({
  build: '.bazel',
  'build.bazel': '.bazel',
  'cmakelists.txt': '.cmake',
  containerfile: '.dockerfile',
  dockerfile: '.dockerfile',
  bsdmakefile: '.makefile',
  gnumakefile: '.makefile',
  makefile: '.makefile',
  module: '.bazel',
  'module.bazel': '.bazel',
  workspace: '.bazel',
  'workspace.bazel': '.bazel',
  'workspace.bzlmod': '.bazel'
});

export const SPECIAL_CODE_PREFIX_TO_EXT = Object.freeze({
  containerfile: '.dockerfile',
  dockerfile: '.dockerfile',
  makefile: '.makefile'
});

export const SPECIAL_CODE_FILENAMES = Object.freeze(
  Object.keys(SPECIAL_CODE_FILENAME_TO_EXT)
);
