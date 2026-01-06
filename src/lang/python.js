import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildLineIndex, lineColToOffset, offsetToLine } from '../shared/lines.js';

/**
 * Python language chunking and relations.
 * Uses optional Python AST parsing with a heuristic fallback.
 */

const PYTHON_CANDIDATES = ['python', 'python3'];
let pythonExecutable = null;
let pythonWarned = false;
let pythonCheckPromise = null;
let pythonPool = null;
let pythonPoolSignature = null;
let pythonPoolHooked = false;

const PYTHON_AST_SCRIPT = `
import ast, json, sys

dataflow_enabled = True
control_flow_enabled = True

def to_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.lower() not in ("0", "false", "no", "off", "")
    return bool(value)

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
                "yields": False,
                "controlFlow": {
                    "branches": 0,
                    "loops": 0,
                    "returns": 0,
                    "breaks": 0,
                    "continues": 0,
                    "throws": 0,
                    "awaits": 0,
                    "yields": 0
                }
            }
        return self.flow[name]
    def record_control(self, kind, amount=1):
        if not control_flow_enabled or not kind:
            return
        scope = self.current_scope()
        if not scope:
            return
        flow = self.ensure_flow(scope)
        if kind in flow["controlFlow"]:
            flow["controlFlow"][kind] += amount
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
        self.record_control("throws")
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["throws"].add(name)
    def record_await(self, name):
        self.record_control("awaits")
        if not dataflow_enabled or not name:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["awaits"].add(name)
    def record_return(self):
        self.record_control("returns")
        if not dataflow_enabled:
            return
        scope = self.current_scope()
        if not scope:
            return
        self.ensure_flow(scope)["returns"] = True
    def record_yield(self):
        self.record_control("yields")
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
    def visit_If(self, node):
        self.record_control("branches")
        self.generic_visit(node)
    def visit_IfExp(self, node):
        self.record_control("branches")
        self.generic_visit(node)
    def visit_For(self, node):
        self.record_control("loops")
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
    def visit_While(self, node):
        self.record_control("loops")
        self.generic_visit(node)
    def visit_Try(self, node):
        if control_flow_enabled:
            branch_count = len(getattr(node, "handlers", []) or [])
            if getattr(node, "orelse", None):
                branch_count += 1
            if getattr(node, "finalbody", None):
                branch_count += 1
            if branch_count:
                self.record_control("branches", branch_count)
        self.generic_visit(node)
    def visit_Match(self, node):
        if control_flow_enabled:
            case_count = len(getattr(node, "cases", []) or [])
            self.record_control("branches", case_count or 1)
        self.generic_visit(node)
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
        self.record_throw(exc)
        self.generic_visit(node)
    def visit_Await(self, node):
        name = await_name(node.value)
        self.record_await(name)
        self.generic_visit(node)
    def visit_Yield(self, node):
        self.record_yield()
        self.generic_visit(node)
    def visit_YieldFrom(self, node):
        self.record_yield()
        self.generic_visit(node)
    def visit_Break(self, node):
        self.record_control("breaks")
        self.generic_visit(node)
    def visit_Continue(self, node):
        self.record_control("continues")
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

def parse_source(source, dataflow_flag=True, control_flow_flag=True):
    global dataflow_enabled, control_flow_enabled
    dataflow_enabled = bool(dataflow_flag)
    control_flow_enabled = bool(control_flow_flag)
    try:
        tree = ast.parse(source)
    except Exception as e:
        return {"error": str(e)}
    collector = Collector()
    collector.visit(tree)
    for entry in collector.defs:
        calls = collector.call_map.get(entry["name"])
        entry["calls"] = sorted(calls) if calls else []
        flow = collector.flow.get(entry["name"])
        if flow:
            if dataflow_enabled:
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
            if control_flow_enabled:
                entry["controlFlow"] = flow["controlFlow"]
    result = {
        "defs": collector.defs,
        "imports": sorted(collector.imports),
        "calls": collector.calls,
        "callDetails": collector.call_details,
        "usages": sorted(collector.usages),
        "exports": sorted(collector.exports)
    }
    return result

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            sys.stdout.write(json.dumps({"id": None, "error": str(e)}) + "\\n")
            sys.stdout.flush()
            continue
        req_id = payload.get("id")
        source = payload.get("text") or ""
        dataflow_flag = to_bool(payload.get("dataflow"), True)
        control_flow_flag = to_bool(payload.get("controlFlow"), True)
        result = parse_source(source, dataflow_flag, control_flow_flag)
        sys.stdout.write(json.dumps({"id": req_id, "result": result}) + "\\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
`;

const PYTHON_AST_DEFAULTS = {
  enabled: true,
  workerCount: 2,
  maxWorkers: 2,
  scaleUpQueueMs: 250,
  taskTimeoutMs: 30000,
  maxRetries: 1,
  maxQueued: null,
  crashLoopMax: 3,
  crashWindowMs: 60000,
  crashBackoffMs: 30000
};

async function checkPythonCandidate(candidate) {
  return new Promise((resolve) => {
    const proc = spawn(candidate, ['-c', 'import sys; sys.stdout.write("ok")'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && output.trim() === 'ok'));
  });
}

async function findPythonExecutable(log) {
  if (pythonExecutable) return pythonExecutable;
  if (pythonCheckPromise) return pythonCheckPromise;
  pythonCheckPromise = (async () => {
    for (const candidate of PYTHON_CANDIDATES) {
      const ok = await checkPythonCandidate(candidate);
      if (ok) {
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
  })();
  return pythonCheckPromise;
}

function normalizePythonAstConfig(config = {}, options = {}) {
  if (config.enabled === false) return { enabled: false };
  const defaultMaxWorkers = Number.isFinite(options.defaultMaxWorkers)
    ? Math.max(1, Math.floor(options.defaultMaxWorkers))
    : PYTHON_AST_DEFAULTS.maxWorkers;
  const hardMaxWorkers = Number.isFinite(options.hardMaxWorkers)
    ? Math.max(1, Math.floor(options.hardMaxWorkers))
    : null;
  const allowOverCap = config.allowOverCap === true || options.allowOverCap === true;
  const workerCountRaw = Number(config.workerCount);
  const workerCount = Number.isFinite(workerCountRaw)
    ? Math.max(1, Math.floor(workerCountRaw))
    : Math.min(PYTHON_AST_DEFAULTS.workerCount, defaultMaxWorkers);
  const maxWorkersRaw = Number(config.maxWorkers);
  const requestedMax = Number.isFinite(maxWorkersRaw)
    ? Math.max(workerCount, Math.floor(maxWorkersRaw))
    : Math.max(workerCount, defaultMaxWorkers);
  const cappedMax = (!allowOverCap && Number.isFinite(hardMaxWorkers))
    ? Math.min(requestedMax, hardMaxWorkers)
    : requestedMax;
  const maxWorkers = Math.max(workerCount, cappedMax);
  const scaleUpQueueMsRaw = Number(config.scaleUpQueueMs);
  const scaleUpQueueMs = Number.isFinite(scaleUpQueueMsRaw)
    ? Math.max(0, Math.floor(scaleUpQueueMsRaw))
    : PYTHON_AST_DEFAULTS.scaleUpQueueMs;
  const taskTimeoutMsRaw = Number(config.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw)
    ? Math.max(1000, Math.floor(taskTimeoutMsRaw))
    : PYTHON_AST_DEFAULTS.taskTimeoutMs;
  const maxRetriesRaw = Number(config.maxRetries);
  const maxRetries = Number.isFinite(maxRetriesRaw)
    ? Math.max(0, Math.floor(maxRetriesRaw))
    : PYTHON_AST_DEFAULTS.maxRetries;
  const maxQueuedRaw = Number(config.maxQueued);
  const maxQueued = Number.isFinite(maxQueuedRaw)
    ? Math.max(0, Math.floor(maxQueuedRaw))
    : null;
  const crashLoopMaxRaw = Number(config.crashLoopMax);
  const crashLoopMax = Number.isFinite(crashLoopMaxRaw)
    ? Math.max(0, Math.floor(crashLoopMaxRaw))
    : PYTHON_AST_DEFAULTS.crashLoopMax;
  const crashWindowMsRaw = Number(config.crashWindowMs);
  const crashWindowMs = Number.isFinite(crashWindowMsRaw)
    ? Math.max(0, Math.floor(crashWindowMsRaw))
    : PYTHON_AST_DEFAULTS.crashWindowMs;
  const crashBackoffMsRaw = Number(config.crashBackoffMs);
  const crashBackoffMs = Number.isFinite(crashBackoffMsRaw)
    ? Math.max(0, Math.floor(crashBackoffMsRaw))
    : PYTHON_AST_DEFAULTS.crashBackoffMs;
  return {
    enabled: true,
    workerCount,
    maxWorkers,
    scaleUpQueueMs,
    taskTimeoutMs,
    maxRetries,
    maxQueued,
    crashLoopMax,
    crashWindowMs,
    crashBackoffMs
  };
}

function createPythonAstPool({ pythonBin, config, log }) {
  const state = {
    pythonBin,
    config,
    log,
    workers: [],
    queue: [],
    nextId: 1,
    stopping: false,
    disabledUntil: 0,
    crashCount: 0,
    crashWindowStart: 0,
    lastBackpressureLog: 0,
    lastDisabledLog: 0
  };

  const isDisabled = () => state.disabledUntil && Date.now() < state.disabledUntil;

  const logOnce = (message, key) => {
    if (typeof log !== 'function' || !message) return;
    const now = Date.now();
    if (key === 'backpressure') {
      if (now - state.lastBackpressureLog < 10000) return;
      state.lastBackpressureLog = now;
    }
    if (key === 'disabled') {
      if (now - state.lastDisabledLog < 10000) return;
      state.lastDisabledLog = now;
    }
    log(message);
  };

  const shutdownWorkers = () => {
    for (const worker of state.workers) {
      try {
        worker.proc.kill();
      } catch {}
    }
    state.workers = [];
  };

  const disablePool = (reason) => {
    if (isDisabled()) return;
    const backoffMs = Number.isFinite(config.crashBackoffMs)
      ? Math.max(0, config.crashBackoffMs)
      : 0;
    if (!backoffMs) return;
    const reasonText = typeof reason === 'string'
      ? reason
      : (reason?.message || String(reason || 'unknown error'));
    state.disabledUntil = Date.now() + backoffMs;
    state.crashCount = 0;
    state.crashWindowStart = 0;
    logOnce(`[python-ast] Crash loop detected; disabling pool for ${backoffMs}ms (${reasonText}).`, 'disabled');
    for (const job of state.queue) {
      job.resolve(null);
    }
    state.queue = [];
    shutdownWorkers();
  };

  const recordCrash = (reason) => {
    if (state.stopping || !reason) return;
    const windowMs = Number.isFinite(config.crashWindowMs) ? config.crashWindowMs : 0;
    const maxCrashes = Number.isFinite(config.crashLoopMax) ? config.crashLoopMax : 0;
    if (!windowMs || !maxCrashes) return;
    const now = Date.now();
    if (!state.crashWindowStart || now - state.crashWindowStart > windowMs) {
      state.crashWindowStart = now;
      state.crashCount = 0;
    }
    state.crashCount += 1;
    if (state.crashCount >= maxCrashes) {
      disablePool(reason);
    }
  };

  const requeueJob = (job, reason) => {
    if (isDisabled()) {
      job.resolve(null);
      return;
    }
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = reason || null;
    if (job.attempts > config.maxRetries) {
      job.resolve(null);
      return;
    }
    job.queuedAt = Date.now();
    state.queue.unshift(job);
  };

  const detachWorker = (worker) => {
    state.workers = state.workers.filter((w) => w !== worker);
  };

  const handleWorkerExit = (worker, reason, options = {}) => {
    if (worker.exited) return;
    if (options.forceKill) {
      try {
        worker.proc.kill();
      } catch {}
    }
    worker.exited = true;
    const pending = Array.from(worker.pending.values());
    worker.pending.clear();
    worker.busy = false;
    detachWorker(worker);
    for (const job of pending) {
      if (job.timer) clearTimeout(job.timer);
      requeueJob(job, reason);
    }
    if (reason && !state.stopping) {
      recordCrash(reason);
    }
    if (!state.stopping && !isDisabled() && state.workers.length < config.workerCount) {
      spawnWorker();
    }
    drainQueue();
  };

  const handleLine = (worker, line) => {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (err) {
      if (typeof log === 'function') {
        log(`[python-ast] Failed to parse worker output: ${String(err)}`);
      }
      return;
    }
    const job = worker.pending.get(payload.id);
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    worker.pending.delete(payload.id);
    worker.busy = false;
    const result = payload?.result;
    if (payload?.error || result?.error) {
      job.resolve(null);
    } else {
      job.resolve(result || null);
    }
    drainQueue();
  };

  const spawnWorker = () => {
    if (state.stopping || isDisabled()) return null;
    const proc = spawn(pythonBin, ['-u', '-c', PYTHON_AST_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    proc.unref();
    const worker = {
      id: state.workers.length + 1,
      proc,
      pending: new Map(),
      busy: false,
      busySince: 0,
      exited: false
    };
    state.workers.push(worker);
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => handleLine(worker, line));
    proc.on('error', (err) => handleWorkerExit(worker, err, { forceKill: true }));
    proc.on('exit', (code, signal) =>
      handleWorkerExit(worker, code ? new Error(`exit ${code}`) : signal)
    );
    proc.stderr.on('data', (chunk) => {
      if (typeof log === 'function' && !state.stopping) {
        log(`[python-ast] ${chunk.toString().trim()}`);
      }
    });
    return worker;
  };

  const assignJob = (worker, job) => {
    if (!worker || worker.exited) return;
    job.startedAt = Date.now();
    worker.busy = true;
    worker.busySince = job.startedAt;
    worker.pending.set(job.id, job);
    const payload = {
      id: job.id,
      text: job.text,
      dataflow: job.dataflow,
      controlFlow: job.controlFlow
    };
    try {
      worker.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      handleWorkerExit(worker, err, { forceKill: true });
      return;
    }
    job.timer = setTimeout(() => {
      handleWorkerExit(worker, new Error('timeout'), { forceKill: true });
    }, config.taskTimeoutMs);
  };

  const maybeScale = () => {
    if (isDisabled()) return;
    if (!state.queue.length) return;
    if (state.workers.length >= config.maxWorkers) return;
    const oldestWaitMs = Date.now() - state.queue[0].queuedAt;
    if (oldestWaitMs < config.scaleUpQueueMs) return;
    spawnWorker();
  };

  const drainQueue = () => {
    if (state.stopping || isDisabled()) return;
    while (state.workers.length < config.workerCount) {
      spawnWorker();
    }
    let idle = state.workers.find((worker) => !worker.busy && !worker.exited);
    while (idle && state.queue.length) {
      const job = state.queue.shift();
      assignJob(idle, job);
      idle = state.workers.find((worker) => !worker.busy && !worker.exited);
    }
    maybeScale();
  };

  for (let i = 0; i < config.workerCount; i += 1) {
    spawnWorker();
  }

  return {
    request(text, { dataflow, controlFlow }) {
      return new Promise((resolve) => {
        if (isDisabled()) {
          const remaining = Math.max(0, state.disabledUntil - Date.now());
          logOnce(`[python-ast] Pool disabled for ${remaining}ms; falling back to heuristic chunking.`, 'disabled');
          resolve(null);
          return;
        }
        const pendingCount = state.queue.length + state.workers.reduce((sum, worker) => sum + worker.pending.size, 0);
        if (Number.isFinite(config.maxQueued) && pendingCount >= config.maxQueued) {
          logOnce('[python-ast] Queue backpressure triggered; falling back to heuristic chunking.', 'backpressure');
          resolve(null);
          return;
        }
        const job = {
          id: state.nextId++,
          text,
          dataflow,
          controlFlow,
          attempts: 0,
          queuedAt: Date.now(),
          resolve
        };
        state.queue.push(job);
        drainQueue();
      });
    },
    shutdown() {
      state.stopping = true;
      shutdownWorkers();
      state.queue = [];
    }
  };
}

async function getPythonAstPool(log, config = {}) {
  const normalized = normalizePythonAstConfig(config, config);
  if (!normalized.enabled) return null;
  const pythonBin = await findPythonExecutable(log);
  if (!pythonBin) return null;
  const signature = JSON.stringify(normalized);
  if (!pythonPool || pythonPoolSignature !== signature) {
    if (pythonPool) pythonPool.shutdown();
    pythonPool = createPythonAstPool({ pythonBin, config: normalized, log });
    pythonPoolSignature = signature;
  }
  if (!pythonPoolHooked) {
    pythonPoolHooked = true;
    process.once('exit', () => pythonPool?.shutdown());
    process.once('SIGINT', () => pythonPool?.shutdown());
    process.once('SIGTERM', () => pythonPool?.shutdown());
  }
  return pythonPool;
}

export function shutdownPythonAstPool() {
  if (pythonPool) {
    pythonPool.shutdown();
    pythonPool = null;
    pythonPoolSignature = null;
  }
}

/**
 * Parse Python source to AST metadata using a local Python interpreter.
 * Returns null when python is unavailable or parsing fails.
 * @param {string} text
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<object|null>}
 */
export async function getPythonAst(text, log, options = {}) {
  const pool = await getPythonAstPool(log, options.pythonAst || {});
  if (!pool) return null;
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  return pool.request(text, { dataflow: dataflowEnabled, controlFlow: controlFlowEnabled });
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
        controlFlow: current.controlFlow || null,
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
    const match = line.match(/^([ \t]*)(async\s+)?(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!match) continue;
    const indent = indentValue(match[1]);
    const isAsync = Boolean(match[2]);
    while (classStack.length && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }
    const kind = match[3] === 'class' ? 'ClassDeclaration' : 'FunctionDeclaration';
    let name = match[4];
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
      kind,
      async: kind === 'FunctionDeclaration' ? isAsync : false
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
        meta: { startLine: current.startLine, endLine, async: current.async || false }
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
  const controlFlow = meta.controlFlow && typeof meta.controlFlow === 'object' ? meta.controlFlow : null;
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
    controlFlow,
    throws,
    awaits,
    yields: meta.yields || false,
    async: meta.async || false
  };
}
