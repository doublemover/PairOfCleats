import { createHash } from 'node:crypto';
import { createTypeIrArena, serializeTypeIr } from '../type-ir/index.js';
import { snapshotPlainData } from '../../../../shared/plain-data-snapshot.js';
import { api7Failure, api7Identity } from './request.js';
import { TYPESCRIPT_API7_PRODUCER_VERSION, TYPESCRIPT_API7_VERSION } from '../../../../shared/typescript-api7-pins.js';

const hashText = text => createHash('sha256').update(text).digest('hex');
const normalize = file => file.replaceAll('\\', '/').toLowerCase();
const bounded = (value, max, reason) => {
  if (!Array.isArray(value) || value.length > max) throw api7Failure(reason); return value;
};
const rawText = (value, max = 16384) => {
  if (typeof value !== 'string' || value.length > max) throw api7Failure('native-text-bound'); return value;
};

/** Every SDK object below is obtained from this one private snapshot. Raw SDK
 * handles never enter or leave the request surface. Compiler-rendered text is
 * presentation only; exact finite strings use the existing context-owned DAG. */
export const projectTypeScriptApi7Snapshot = async ({ sdk, snapshot, request, virtualRoot, toolIdentity }) => {
  let retainedBytes = 0;
  const charge = bytes => { retainedBytes += bytes; if (retainedBytes > 6 * 1024 * 1024) throw api7Failure('projection-retained-byte-bound'); };
  const text = (value, max) => { rawText(value, max); charge(Buffer.byteLength(value) + 128); return value; };
  const json = (value, maxDepth) => {
    const owned = snapshotPlainData(value, { maxBytes: 65536, maxDepth, maxItems: 128 });
    charge(Buffer.byteLength(JSON.stringify(owned)) + 256); return owned;
  };
  const sources = new Map(request.files.map(file => [normalize(virtualRoot + '/' + file.path), file]));
  const worldIdentity = 'ts-api7-world-v1:' + api7Identity({ request, virtualRoot, snapshotId: snapshot.id,
    toolIdentity, version: TYPESCRIPT_API7_VERSION, producer: TYPESCRIPT_API7_PRODUCER_VERSION });
  const arena = createTypeIrArena({ contextKey: worldIdentity, maxArenaNodes: 4096, maxArenaBytes: 4 * 1024 * 1024 });
  const finiteCache = new WeakMap(), activeTypes = new Set(); let typeWork = 0;
  const admitted = file => {
    const source = sources.get(normalize(file));
    if (!source) throw api7Failure('native-source-outside-request'); return source;
  };
  const finite = async (type, depth = 0) => {
    if (++typeWork > 4096 || depth > 32) throw api7Failure('type-projection-budget');
    if (finiteCache.has(type)) return finiteCache.get(type);
    if (activeTypes.has(type)) return null;
    activeTypes.add(type); let root = null;
    try {
      if (type.isErrorType()) return null;
      if (type.flags & sdk.TypeFlags.StringLiteral) root = arena.literal(text(type.value));
      else if (type.flags & sdk.TypeFlags.Never) root = arena.union([]);
      else if (type.flags & sdk.TypeFlags.Union) {
        const children = [];
        for (const item of bounded(await type.getTypes(), 128, 'type-union-bound')) {
          const child = await finite(item, depth + 1); if (!child) return null; children.push(child);
        }
        root = arena.union(children);
      } else if (type.flags & sdk.TypeFlags.TemplateLiteral) {
        const types = bounded(await type.getTypes(), 128, 'template-type-bound');
        const segments = bounded(type.texts, 129, 'template-text-bound');
        if (segments.length !== types.length + 1) throw api7Failure('invalid-native-template');
        const children = [arena.literal(text(segments[0]))];
        for (let index = 0; index < types.length; index++) {
          const child = await finite(types[index], depth + 1); if (!child) return null;
          children.push(child, arena.literal(text(segments[index + 1])));
        }
        root = arena.concat(children);
      }
      return root;
    } finally { activeTypes.delete(type); finiteCache.set(type, root); }
  };
  const typeRecord = async (type, checker) => {
    charge(512);
    if (!type) return { status: 'unavailable', reason: 'native-type-missing' };
    const compilerText = text(await checker.typeToString(type));
    if (type.isErrorType()) return { status: 'unknown', reason: 'native-error-type', native: { compilerText, flags: type.flags } };
    const root = await finite(type);
    const serialized = root ? serializeTypeIr(arena, root) : null;
    if (serialized) charge(Buffer.byteLength(serialized));
    return { status: root ? 'exact-finite-string' : 'native-only', native: { compilerText, flags: type.flags },
      finiteString: root ? { contextKey: worldIdentity, rootId: root.id, graph: JSON.parse(serialized) } : null };
  };
  const declaration = async handle => {
    charge(512);
    const source = admitted(text(handle.path, 1024)), node = await handle.resolve();
    if (!node || !Number.isSafeInteger(node.pos) || !Number.isSafeInteger(node.end)
      || node.pos < 0 || node.end < node.pos || node.end > source.text.length) throw api7Failure('invalid-native-declaration-span');
    return { path: source.path, sourceHash: hashText(source.text), start: node.pos, end: node.end,
      coordinates: 'utf16-full-span', syntaxKind: node.kind, text: text(source.text.slice(node.pos, node.end), 65536) };
  };
  const symbolRecord = async (symbol, checker, aliases = true) => {
    if (!symbol) return null;
    charge(512);
    const declarations = [];
    for (const handle of bounded(symbol.declarations, 128, 'declaration-count-bound')) declarations.push(await declaration(handle));
    const result = { name: text(symbol.name, 1024), declarations,
      native: { flags: symbol.flags, documentation: text(await symbol.getDocumentationComment(checker)),
        jsDocTags: json(await symbol.getJsDocTags(checker), 8) }, aliasTarget: null };
    if (aliases && symbol.flags & sdk.SymbolFlags.Alias) {
      const target = await checker.getAliasedSymbol(symbol);
      result.aliasTarget = await checker.isUnknownSymbol(target) ? { status: 'unresolved' }
        : { status: 'resolved', symbol: await symbolRecord(target, checker, false) };
    }
    return result;
  };
  const signatureRecord = async (signature, checker) => {
    charge(512);
    const parameters = [];
    for (const parameter of bounded(await signature.getParameters(), 64, 'signature-parameter-bound')) {
      parameters.push({ symbol: await symbolRecord(parameter, checker, false), type: await typeRecord(await checker.getTypeOfSymbol(parameter), checker) });
    }
    const typeParameters = bounded(await signature.getTypeParameters(), 32, 'signature-type-parameter-bound');
    return { parameters, returnType: await typeRecord(await signature.getReturnType(), checker),
      declaration: signature.declaration ? await declaration(signature.declaration) : null,
      native: { hasRestParameter: signature.hasRestParameter, isConstruct: signature.isConstruct,
        isAbstract: signature.isAbstract, typeParameterCount: typeParameters.length } };
  };
  const projects = bounded([...snapshot.getProjects()], 32, 'project-count-bound');
  const projectRecords = [], diagnostics = []; let diagnosticCount = 0;
  const diagnosticRecord = (item, depth = 0) => {
    charge(512);
    if (++diagnosticCount > 2048 || depth > 8) throw api7Failure('diagnostic-bound');
    const source = item.fileName ? admitted(item.fileName) : null;
    return { path: source?.path || null, sourceHash: source ? hashText(source.text) : null,
      start: item.pos, end: item.end, code: item.code, category: item.category, text: text(item.text),
      messageChain: bounded(item.messageChain || [], 128, 'diagnostic-chain-bound').map(child => diagnosticRecord(child, depth + 1)),
      relatedInformation: bounded(item.relatedInformation || [], 128, 'diagnostic-related-bound').map(child => diagnosticRecord(child, depth + 1)) };
  };
  for (const project of projects) {
    charge(65536);
    const program = project.program, files = [];
    for (const fileName of bounded(await program.getSourceFileNames(), 128, 'program-source-count-bound')) {
      const source = admitted(fileName), ast = await program.getSourceFile(fileName);
      if (!ast || ast.text !== source.text) throw api7Failure('native-source-bytes-mismatch');
      files.push({ path: source.path, sourceHash: hashText(source.text) });
    }
    const configFiles = [];
    for (const fileName of bounded(await program.getConfigFileNames(), 128, 'config-source-count-bound')) {
      const source = admitted(fileName), ast = await program.getConfigSourceFile(fileName);
      if (!ast || ast.text !== source.text) throw api7Failure('native-config-bytes-mismatch');
      configFiles.push({ path: source.path, sourceHash: hashText(source.text) });
    }
    const configFile = project.configFileName ? admitted(project.configFileName).path : null;
    const compilerOptions = json(program.getCompilerOptions(), 12);
    projectRecords.push({ id: project.id, configFile, configFiles, files, compilerOptions });
    for (const kind of ['ConfigFileParsing', 'Program', 'Global', 'Syntactic', 'Bind', 'Semantic', 'Suggestion']) {
      for (const item of bounded(await program['get' + kind + 'Diagnostics'](), 2048, 'diagnostic-count-bound'))
        diagnostics.push({ projectId: project.id, phase: kind.toLowerCase(), ...diagnosticRecord(item) });
    }
  }
  if (request.project.kind === 'roots' && projects.length !== 1) throw api7Failure('explicit-program-identity');
  const answers = [];
  for (const query of request.queries) {
    charge(512);
    const project = request.project.kind === 'roots' ? projects[0] : snapshot.getConfiguredProject(virtualRoot + '/' + query.configFile);
    if (!project) throw api7Failure('configured-project-unavailable');
    const file = virtualRoot + '/' + query.path, source = admitted(file);
    if (!projectRecords.find(item => item.id === project.id)?.files.some(item => item.path === query.path)) throw api7Failure('query-outside-selected-program');
    const checker = project.checker, symbol = await checker.getSymbolAtPosition(file, query.position);
    const type = await checker.getTypeAtPosition(file, query.position), signatures = [];
    if (type && !type.isErrorType()) for (const kind of [sdk.SignatureKind.Call, sdk.SignatureKind.Construct]) {
      for (const signature of bounded(await checker.getSignaturesOfType(type, kind), 64, 'signature-count-bound'))
        signatures.push(await signatureRecord(signature, checker));
    }
    answers.push({ id: query.id, worldIdentity, projectId: project.id, path: query.path, sourceHash: hashText(source.text),
      position: query.position, symbol: await symbolRecord(symbol, checker), type: await typeRecord(type, checker), signatures });
  }
  return { worldIdentity, snapshotId: snapshot.id, projects: projectRecords, diagnostics, answers,
    coverage: { scope: 'supplied-files-only', defaultLibraries: 'not-implicitly-mounted',
      typeDomain: 'exact-finite-string-or-explicit-native-only', syntaxSpans: 'utf16-full-span',
      mixedSnapshotHandles: 'not-admitted', bridgeRetirement: 'not-qualified' } };
};
