import { spawnSync } from 'node:child_process';
import { buildLineIndex, lineColToOffset, offsetToLine } from '../shared/lines.js';

/**
 * Python language chunking and relations.
 * Uses optional Python AST parsing with a heuristic fallback.
 */

const PYTHON_CANDIDATES = ['python', 'python3'];
let pythonExecutable = null;
let pythonChecked = false;
let pythonWarned = false;

const PYTHON_AST_SCRIPT = `
import ast, json, os, sys
source = sys.stdin.read()
try:
    tree = ast.parse(source)
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(0)

dataflow_enabled = os.environ.get("PAIROFCLEATS_AST_DATAFLOW", "1").lower() not in ("0", "false", "no")

def safe_unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return None

def deco_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = deco_name(node.value)
        return base + "." + node.attr if base else node.attr
    if isinstance(node, ast.Call):
        return deco_name(node.func)
    return None

def call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = call_name(node.value)
        return base + "." + node.attr if base else node.attr
    return None

def format_arg(arg, default_map):
    name = arg.arg
    ann = safe_unparse(arg.annotation) if getattr(arg, "annotation", None) is not None else None
    value = name + (": " + ann if ann else "")
    if name in default_map:
        default = safe_unparse(default_map[name]) if default_map[name] is not None else None
        value += ("=" + default) if default else "=..."
    return value

def format_args(args):
    defaults = list(args.defaults) if args.defaults else []
    default_map = {}
    if defaults and args.args:
        for arg, default in zip(args.args[-len(defaults):], defaults):
            default_map[arg.arg] = default
    if getattr(args, "kw_defaults", None) and args.kwonlyargs:
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            if default is not None:
                default_map[arg.arg] = default

    parts = []
    for arg in getattr(args, "posonlyargs", []):
        parts.append(format_arg(arg, default_map))
    if getattr(args, "posonlyargs", []):
        parts.append("/")
    for arg in args.args:
        parts.append(format_arg(arg, default_map))
    if args.vararg:
        parts.append("*" + format_arg(args.vararg, {}))
    elif args.kwonlyargs:
        parts.append("*")
    for arg in args.kwonlyargs:
        parts.append(format_arg(arg, default_map))
    if args.kwarg:
        parts.append("**" + format_arg(args.kwarg, {}))
    return ", ".join(parts)

def format_signature(node):
    args = format_args(node.args)
    sig = "def " + node.name + "(" + args + ")"
    if getattr(node, "returns", None) is not None:
        ret = safe_unparse(node.returns)
        if ret:
            sig += " -> " + ret
    return sig

def format_class_signature(node):
    bases = [safe_unparse(b) for b in node.bases] if node.bases else []
    bases = [b for b in bases if b]
    sig = "class " + node.name
    if bases:
        sig += "(" + ", ".join(bases) + ")"
    return sig

def is_dataclass_decorator(decorators):
    for name in decorators:
        if name in ("dataclass", "attrs.define", "attr.s", "attr.define"):
            return True
    return False

def extract_fields(node):
    fields = []
    for stmt in getattr(node, "body", []):
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            name = stmt.target.id
            ann = safe_unparse(stmt.annotation) if stmt.annotation is not None else None
            default = safe_unparse(stmt.value) if stmt.value is not None else None
            fields.append({"name": name, "type": ann, "default": default})
        elif isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            name = stmt.targets[0].id
            default = safe_unparse(stmt.value) if stmt.value is not None else None
            fields.append({"name": name, "type": None, "default": default})
    return fields

def visibility_for(name):
    if not name:
        return "public"
    if name.startswith("__") and not name.endswith("__"):
        return "private"
    if name.startswith("_") and not name.startswith("__"):
        return "protected"
    if name.startswith("__") and name.endswith("__"):
        return "dunder"
    return "public"

def collect_param_info(args):
    defaults = list(args.defaults) if args.defaults else []
    default_map = {}
    if defaults and args.args:
        for arg, default in zip(args.args[-len(defaults):], defaults):
            default_map[arg.arg] = default
    if getattr(args, "kw_defaults", None) and args.kwonlyargs:
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            if default is not None:
                default_map[arg.arg] = default

    params = []
    param_types = {}
    param_defaults = {}

    def add_arg(arg, defaults_map):
        name = arg.arg
        params.append(name)
        if getattr(arg, "annotation", None) is not None:
            ann = safe_unparse(arg.annotation)
            if ann:
                param_types[name] = ann
        if name in defaults_map:
            value = safe_unparse(defaults_map[name]) if defaults_map[name] is not None else None
            param_defaults[name] = value if value is not None else "..."

    for arg in getattr(args, "posonlyargs", []):
        add_arg(arg, default_map)
    for arg in args.args:
        add_arg(arg, default_map)
    if args.vararg:
        add_arg(args.vararg, {})
    for arg in args.kwonlyargs:
        add_arg(arg, default_map)
    if args.kwarg:
        add_arg(args.kwarg, {})
    return params, param_types, param_defaults

def target_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = call_name(node.value) or target_name(node.value)
        return base + "." + node.attr if base else node.attr
    if isinstance(node, ast.Subscript):
        base = call_name(node.value) or target_name(node.value)
        return base + "[]" if base else None
    return None

def collect_targets(node, writes, mutations):
    if isinstance(node, (ast.Tuple, ast.List)):
        for elt in node.elts:
            collect_targets(elt, writes, mutations)
        return
    if isinstance(node, ast.Name):
        writes.add(node.id)
        return
    if isinstance(node, (ast.Attribute, ast.Subscript)):
        name = target_name(node)
        if name:
            mutations.add(name)
        return

def await_name(node):
    if isinstance(node, ast.Call):
        return call_name(node.func)
    return call_name(node)

def alias_target(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return call_name(node) or target_name(node)
    return None

def format_arg_value(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Constant):
        return repr(node.value)
    if isinstance(node, ast.Attribute):
        return call_name(node) or target_name(node) or "attr"
    if isinstance(node, ast.Call):
        callee = call_name(node.func)
        return f"{callee}(...)" if callee else "call(...)"
    if isinstance(node, ast.Lambda):
        return "lambda"
    if isinstance(node, ast.Dict):
        return "{...}"
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return "[...]"
    return "..."

class Collector(ast.NodeVisitor):
    def __init__(self):
        self.defs = []
        self.imports = set()
        self.calls = []
        self.call_details = []
        self.usages = set()
        self.exports = set()
        self.class_stack = []
        self.func_stack = []
        self.call_map = {}
        self.flow = {}
        self.scope_stack = []
    def current_func(self):
        return self.func_stack[-1] if self.func_stack else "(module)"
    def current_scope(self):
        return self.scope_stack[-1] if self.scope_stack else None
    def ensure_flow(self, name):
        if name not in self.flow:
            self.flow[name] = {
                "reads": set(),
                "writes": set(),
                "mutations": set(),
                "aliases": set(),
                "globals": set(),
                "nonlocals": set(),
                "throws": set(),
                "awaits": set(),
                "returns": False,
                "yields": False
            }
        return self.flow[name]
    def record_read(self, name):
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["reads"].add(name)
    def record_write(self, name):
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["writes"].add(name)
    def record_mutation(self, name):
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["mutations"].add(name)
    def record_alias(self, name, target):
        if not dataflow_enabled or not name or not target:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["aliases"].add(name + "=" + target)
    def record_throw(self, name):
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["throws"].add(name)
    def record_await(self, name):
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["awaits"].add(name)
    def record_return(self):
        if not dataflow_enabled:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["returns"] = True
    def record_yield(self):
        if not dataflow_enabled:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["yields"] = True
    def record_def(self, node, kind, name):
        doc = ast.get_docstring(node) or ""
        decorators = []
        for d in getattr(node, "decorator_list", []):
            dn = deco_name(d)
            if dn:
                decorators.append(dn)
        params = []
        param_types = {}
        param_defaults = {}
        if hasattr(node, "args"):
            params, param_types, param_defaults = collect_param_info(node.args)
        visibility = visibility_for(name.split(".")[-1] if name else name)
        entry = {
            "kind": kind,
            "name": name,
            "startLine": getattr(node, "lineno", None),
            "startCol": getattr(node, "col_offset", None),
            "endLine": getattr(node, "end_lineno", None),
            "endCol": getattr(node, "end_col_offset", None),
            "docstring": doc,
            "decorators": decorators,
            "params": params,
            "paramTypes": param_types,
            "paramDefaults": param_defaults,
            "visibility": visibility
        }
        entry["modifiers"] = {
            "async": False,
            "generator": False,
            "visibility": visibility
        }
        if kind in ("FunctionDeclaration", "MethodDeclaration"):
            entry["signature"] = format_signature(node)
            entry["returnType"] = safe_unparse(node.returns) if getattr(node, "returns", None) is not None else None
            entry["async"] = isinstance(node, ast.AsyncFunctionDef)
            entry["modifiers"]["async"] = entry["async"]
        elif kind == "ClassDeclaration":
            entry["signature"] = format_class_signature(node)
            bases = [safe_unparse(b) for b in node.bases] if node.bases else []
            entry["bases"] = [b for b in bases if b]
            if is_dataclass_decorator(decorators):
                entry["fields"] = extract_fields(node)
        self.defs.append(entry)
    def visit_ClassDef(self, node):
        name = node.name
        qualified = ".".join(self.class_stack + [name]) if self.class_stack else name
        if not self.func_stack:
            self.exports.add(qualified)
        self.record_def(node, "ClassDeclaration", qualified)
        self.class_stack.append(name)
        self.scope_stack.append(qualified)
        self.generic_visit(node)
        self.scope_stack.pop()
        self.class_stack.pop()
    def visit_FunctionDef(self, node):
        name = node.name
        base = self.func_stack[-1] if self.func_stack else (".".join(self.class_stack) if self.class_stack else "")
        qualified = base + "." + name if base else name
        is_method = bool(self.class_stack) and not self.func_stack
        kind = "MethodDeclaration" if is_method else "FunctionDeclaration"
        if not self.func_stack:
            self.exports.add(qualified)
        self.record_def(node, kind, qualified)
        self.func_stack.append(qualified)
        self.scope_stack.append(qualified)
        self.generic_visit(node)
        self.scope_stack.pop()
        self.func_stack.pop()
    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)
    def visit_Import(self, node):
        for alias in node.names:
            self.imports.add(alias.name)
            if alias.asname:
                self.usages.add(alias.asname)
    def visit_ImportFrom(self, node):
        if node.module:
            self.imports.add(node.module)
        for alias in node.names:
            if alias.name:
                self.usages.add(alias.name)
            if alias.asname:
                self.usages.add(alias.asname)
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.usages.add(node.id)
            self.record_read(node.id)
        elif isinstance(node.ctx, ast.Store):
            self.record_write(node.id)
    def visit_Call(self, node):
        callee = call_name(node.func)
        if callee:
            caller = self.current_func()
            self.calls.append([caller, callee])
            self.call_map.setdefault(caller, set()).add(callee)
            args = []
            for arg in node.args:
                args.append(format_arg_value(arg))
            for kw in node.keywords:
                if kw.arg:
                    args.append(f"{kw.arg}=" + format_arg_value(kw.value))
                else:
                    args.append("**...")
            self.call_details.append({"caller": caller, "callee": callee, "args": args})
        self.generic_visit(node)
    def visit_Assign(self, node):
        writes = set()
        mutations = set()
        for target in node.targets:
            collect_targets(target, writes, mutations)
        for name in writes:
            self.record_write(name)
        for name in mutations:
            self.record_mutation(name)
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target = alias_target(node.value)
            if target:
                self.record_alias(node.targets[0].id, target)
        self.generic_visit(node)
    def visit_AnnAssign(self, node):
        writes = set()
        mutations = set()
        collect_targets(node.target, writes, mutations)
        for name in writes:
            self.record_write(name)
        for name in mutations:
            self.record_mutation(name)
        if isinstance(node.target, ast.Name):
            target = alias_target(node.value) if getattr(node, "value", None) is not None else None
            if target:
                self.record_alias(node.target.id, target)
        self.generic_visit(node)
    def visit_AugAssign(self, node):
        writes = set()
        mutations = set()
        collect_targets(node.target, writes, mutations)
        for name in writes:
            self.record_read(name)
            self.record_write(name)
        for name in mutations:
            self.record_mutation(name)
        self.generic_visit(node)
    def visit_For(self, node):
        writes = set()
        mutations = set()
        collect_targets(node.target, writes, mutations)
        for name in writes:
            self.record_write(name)
        for name in mutations:
            self.record_mutation(name)
        self.generic_visit(node)
    def visit_AsyncFor(self, node):
        self.visit_For(node)
    def visit_With(self, node):
        for item in node.items:
            if item.optional_vars:
                writes = set()
                mutations = set()
                collect_targets(item.optional_vars, writes, mutations)
                for name in writes:
                    self.record_write(name)
                for name in mutations:
                    self.record_mutation(name)
        self.generic_visit(node)
    def visit_AsyncWith(self, node):
        self.visit_With(node)
    def visit_Return(self, node):
        self.record_return()
        self.generic_visit(node)
    def visit_Raise(self, node):
        exc = None
        if node.exc is not None:
            exc = call_name(node.exc) or safe_unparse(node.exc)
        if exc:
            self.record_throw(exc)
        self.generic_visit(node)
    def visit_Await(self, node):
        name = await_name(node.value)
        if name:
            self.record_await(name)
        self.generic_visit(node)
    def visit_Yield(self, node):
        self.record_yield()
        self.generic_visit(node)
    def visit_YieldFrom(self, node):
        self.record_yield()
        self.generic_visit(node)
    def visit_Global(self, node):
        if dataflow_enabled:
            scope = self.current_scope()
            if scope:
                flow = self.ensure_flow(scope)
                for name in node.names:
                    flow["globals"].add(name)
        self.generic_visit(node)
    def visit_Nonlocal(self, node):
        if dataflow_enabled:
            scope = self.current_scope()
            if scope:
                flow = self.ensure_flow(scope)
                for name in node.names:
                    flow["nonlocals"].add(name)
        self.generic_visit(node)

collector = Collector()
collector.visit(tree)
for entry in collector.defs:
    calls = collector.call_map.get(entry["name"])
    entry["calls"] = sorted(calls) if calls else []
    flow = collector.flow.get(entry["name"])
    if flow:
        entry["dataflow"] = {
            "reads": sorted(flow["reads"]),
            "writes": sorted(flow["writes"]),
            "mutations": sorted(flow["mutations"]),
            "aliases": sorted(flow["aliases"]),
            "globals": sorted(flow["globals"]),
            "nonlocals": sorted(flow["nonlocals"])
        }
        entry["throws"] = sorted(flow["throws"])
        entry["awaits"] = sorted(flow["awaits"])
        entry["returnsValue"] = bool(flow["returns"])
        entry["yields"] = bool(flow["yields"])
        entry["modifiers"] = {
            "async": bool(entry.get("async")),
            "generator": bool(flow["yields"]),
            "visibility": entry.get("visibility") or "public"
        }
result = {
    "defs": collector.defs,
    "imports": sorted(collector.imports),
    "calls": collector.calls,
    "callDetails": collector.call_details,
    "usages": sorted(collector.usages),
    "exports": sorted(collector.exports)
}
print(json.dumps(result))
`;

function findPythonExecutable(log) {
  if (pythonChecked) return pythonExecutable;
  pythonChecked = true;
  for (const candidate of PYTHON_CANDIDATES) {
    const result = spawnSync(candidate, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') {
      pythonExecutable = candidate;
      break;
    }
  }
  if (!pythonExecutable && !pythonWarned) {
    if (typeof log === 'function') {
      log('Python AST unavailable (python not found); using heuristic chunking for .py.');
    }
    pythonWarned = true;
  }
  return pythonExecutable;
}

/**
 * Parse Python source to AST metadata using a local Python interpreter.
 * Returns null when python is unavailable or parsing fails.
 * @param {string} text
 * @param {(msg:string)=>void} [log]
 * @returns {object|null}
 */
export function getPythonAst(text, log, options = {}) {
  const pythonBin = findPythonExecutable(log);
  if (!pythonBin) return null;
  const dataflowEnabled = options.dataflow !== false;
  const result = spawnSync(pythonBin, ['-c', PYTHON_AST_SCRIPT], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PAIROFCLEATS_AST_DATAFLOW: dataflowEnabled ? '1' : '0'
    }
  });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed && parsed.error) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build chunk metadata from Python AST metadata.
 * Returns null when AST data is missing.
 * @param {string} text
 * @param {object} astData
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPythonChunksFromAst(text, astData) {
  if (!astData || !Array.isArray(astData.defs) || !astData.defs.length) return null;
  const lineIndex = buildLineIndex(text);
  const defs = astData.defs
    .filter((def) => Number.isFinite(def.startLine))
    .map((def) => ({
      ...def,
      start: lineColToOffset(lineIndex, def.startLine, def.startCol)
    }))
    .sort((a, b) => a.start - b.start);
  if (!defs.length) return null;

  const chunks = [];
  for (let i = 0; i < defs.length; i++) {
    const current = defs[i];
    const next = defs[i + 1];
    let end = null;
    if (Number.isFinite(current.endLine)) {
      end = lineColToOffset(lineIndex, current.endLine, current.endCol || 0);
    }
    if (!end || end <= current.start) {
      end = next ? next.start : text.length;
    }
    const endLine = offsetToLine(lineIndex, end);
    chunks.push({
      start: current.start,
      end,
      name: current.name,
      kind: current.kind || 'FunctionDeclaration',
      meta: {
        startLine: current.startLine,
        endLine,
        decorators: current.decorators || [],
        signature: current.signature || null,
        params: current.params || [],
        returnType: current.returnType || current.returns || null,
        returnsValue: current.returnsValue || false,
        paramTypes: current.paramTypes || {},
        paramDefaults: current.paramDefaults || {},
        visibility: current.visibility || null,
        bases: current.bases || [],
        modifiers: current.modifiers || null,
        dataflow: current.dataflow || null,
        throws: current.throws || [],
        awaits: current.awaits || [],
        yields: current.yields || false,
        async: current.async || false,
        docstring: current.docstring || '',
        fields: current.fields || []
      }
    });
  }
  return chunks;
}

/**
 * Heuristic Python chunker when AST is unavailable.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPythonHeuristicChunks(text) {
  const lineIndex = buildLineIndex(text);
  const defs = [];
  const classStack = [];
  const indentValue = (prefix) => prefix.replace(/\t/g, '    ').length;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^([ \t]*)(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!match) continue;
    const indent = indentValue(match[1]);
    while (classStack.length && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }
    const kind = match[2] === 'class' ? 'ClassDeclaration' : 'FunctionDeclaration';
    let name = match[3];
    if (kind === 'ClassDeclaration') {
      classStack.push({ name, indent });
    } else if (classStack.length && indent > classStack[classStack.length - 1].indent) {
      name = `${classStack[classStack.length - 1].name}.${name}`;
    }
    defs.push({
      start: lineIndex[i],
      startLine: i + 1,
      indent,
      name,
      kind
    });
  }
  if (defs.length) {
    const chunks = [];
    for (let i = 0; i < defs.length; i++) {
      const current = defs[i];
      let end = text.length;
      for (let j = i + 1; j < defs.length; j++) {
        if (defs[j].indent <= current.indent) {
          end = defs[j].start;
          break;
        }
      }
      const endLine = offsetToLine(lineIndex, end);
      chunks.push({
        start: current.start,
        end,
        name: current.name,
        kind: current.kind,
        meta: { startLine: current.startLine, endLine }
      });
    }
    return chunks;
  }
  return null;
}

/**
 * Collect Python import statements and simple usages.
 * @param {string} text
 * @returns {{imports:string[],usages:string[]}}
 */
export function collectPythonImports(text) {
  const imports = new Set();
  const usages = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/^import\s+(.+)$/);
    if (match) {
      const parts = match[1].split(',').map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const [moduleName, alias] = part.split(/\s+as\s+/);
        if (moduleName) imports.add(moduleName);
        if (alias) usages.add(alias);
      }
      continue;
    }
    match = trimmed.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)$/);
    if (match) {
      imports.add(match[1]);
      const names = match[2].split(',').map((p) => p.trim()).filter(Boolean);
      for (const namePart of names) {
        const [name, alias] = namePart.split(/\s+as\s+/);
        if (name) usages.add(name);
        if (alias) usages.add(alias);
      }
    }
  }
  return { imports: Array.from(imports), usages: Array.from(usages) };
}

/**
 * Build import/export/call/usage relations for Python chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {object|null} pythonAst
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildPythonRelations(text, allImports, pythonAst) {
  let imports = [];
  let usages = [];
  let calls = [];
  let callDetails = [];
  let exports = [];
  if (pythonAst) {
    imports = Array.isArray(pythonAst.imports) ? pythonAst.imports : [];
    usages = Array.isArray(pythonAst.usages) ? pythonAst.usages : [];
    calls = Array.isArray(pythonAst.calls) ? pythonAst.calls : [];
    callDetails = Array.isArray(pythonAst.callDetails) ? pythonAst.callDetails : [];
    exports = Array.isArray(pythonAst.exports) ? pythonAst.exports : [];
  } else {
    const fallback = collectPythonImports(text);
    imports = fallback.imports;
    usages = fallback.usages;
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports,
    calls,
    callDetails,
    usages,
    importLinks
  };
}

/**
 * Normalize Python-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],fields:Array<{name:string,type:(string|null),default:(string|null)}>>}}
 */
export function extractPythonDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.decorators) ? meta.decorators : [];
  const fields = Array.isArray(meta.fields) ? meta.fields : [];
  const modifiers = meta.modifiers && typeof meta.modifiers === 'object' ? meta.modifiers : null;
  const dataflow = meta.dataflow && typeof meta.dataflow === 'object' ? meta.dataflow : null;
  const bases = Array.isArray(meta.bases) ? meta.bases : [];
  const throws = Array.isArray(meta.throws) ? meta.throws : [];
  const awaits = Array.isArray(meta.awaits) ? meta.awaits : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returnType: meta.returnType || meta.returns || null,
    returnsValue: meta.returnsValue || false,
    paramTypes: meta.paramTypes || {},
    paramDefaults: meta.paramDefaults || {},
    signature: meta.signature || null,
    decorators,
    fields,
    modifiers,
    visibility: meta.visibility || null,
    bases,
    dataflow,
    throws,
    awaits,
    yields: meta.yields || false,
    async: meta.async || false
  };
}
