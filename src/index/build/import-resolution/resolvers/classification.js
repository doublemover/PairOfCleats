import path from 'node:path';
import { normalizeRelPath } from '../path-utils.js';
import {
  CLIKE_IMPORTER_EXTS,
  PATH_LIKE_IMPORTER_EXTS,
  PYTHON_MODULE_EXTENSIONS
} from './common-paths.js';

/**
 * Classify importer capabilities once so later resolution branches can remain
 * branch-predictable and avoid repeated extension/path checks per specifier.
 *
 * @param {string} importerRel
 * @returns {{
 *   importerRel:string,
 *   importerDir:string,
 *   extension:string,
 *   baseName:string,
 *   isRuby:boolean,
 *   isPython:boolean,
 *   isPerl:boolean,
 *   isLua:boolean,
 *   isPhp:boolean,
 *   isGo:boolean,
 *   isJava:boolean,
 *   isKotlin:boolean,
 *   isCsharp:boolean,
 *   isSwift:boolean,
 *   isRust:boolean,
 *   isDart:boolean,
 *   isScala:boolean,
 *   isGroovy:boolean,
 *   isJulia:boolean,
 *   isShell:boolean,
 *   isClike:boolean,
 *   isPathLike:boolean
 * }}
 */
export const classifyImporter = (importerRel) => {
  const importerPath = normalizeRelPath(importerRel);
  const extension = path.posix.extname(importerPath).toLowerCase();
  const baseName = path.posix.basename(importerPath).toLowerCase();
  const importerDir = path.posix.dirname(importerPath);

  const isRuby = importerPath.endsWith('.rb')
    || importerPath.endsWith('.rake')
    || importerPath.endsWith('.ru')
    || importerPath.endsWith('.gemspec')
    || baseName === 'rakefile'
    || baseName === 'gemfile';
  const isPython = PYTHON_MODULE_EXTENSIONS.includes(extension);
  const isPerl = extension === '.pl' || extension === '.pm' || extension === '.t';
  const isLua = extension === '.lua';
  const isPhp = extension === '.php';
  const isGo = extension === '.go';
  const isJava = extension === '.java';
  const isKotlin = extension === '.kt' || extension === '.kts';
  const isCsharp = extension === '.cs';
  const isSwift = extension === '.swift';
  const isRust = extension === '.rs';
  const isDart = extension === '.dart';
  const isScala = extension === '.scala';
  const isGroovy = extension === '.groovy' || extension === '.gradle';
  const isJulia = extension === '.jl';
  const isShell = extension === '.sh'
    || extension === '.bash'
    || extension === '.zsh'
    || extension === '.ksh'
    || extension === '.fish'
    || baseName === 'bashrc'
    || baseName === 'zshrc';
  const isClike = CLIKE_IMPORTER_EXTS.has(extension);
  const isPathLike = PATH_LIKE_IMPORTER_EXTS.has(extension)
    || baseName === 'cmakelists.txt'
    || baseName === 'makefile'
    || baseName === 'dockerfile'
    || baseName === 'pipfile'
    || baseName.endsWith('.mk');

  return {
    importerRel: importerPath,
    importerDir,
    extension,
    baseName,
    isRuby,
    isPython,
    isPerl,
    isLua,
    isPhp,
    isGo,
    isJava,
    isKotlin,
    isCsharp,
    isSwift,
    isRust,
    isDart,
    isScala,
    isGroovy,
    isJulia,
    isShell,
    isClike,
    isPathLike
  };
};
