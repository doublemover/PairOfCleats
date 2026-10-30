export const PYTHON_AST_SCRIPT = `
import ast, io, json, sys, tokenize, warnings

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

def build_default_map(args):
    defaults = list(args.defaults) if args.defaults else []
    default_map = {}
    positional = list(getattr(args, "posonlyargs", [])) + list(args.args)
    if defaults:
        for arg, default in zip(positional[-len(defaults):], defaults):
            default_map[arg.arg] = default
    if getattr(args, "kw_defaults", None) and args.kwonlyargs:
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            if default is not None:
                default_map[arg.arg] = default
    return default_map

def format_args(args):
    default_map = build_default_map(args)
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
    default_map = build_default_map(args)

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

def declaration_prefixes(source):
    prefixes = {}
    pending = None
    logical_start = True
    try:
        # Universal physical lines match ast.parse's rows. Token columns refer
        # to unchanged line content; JS maps those rows to original delimiters.
        for token in tokenize.generate_tokens(io.StringIO(source, newline=None).readline):
            if token.type in (tokenize.INDENT, tokenize.DEDENT, tokenize.NL, tokenize.COMMENT, tokenize.ENDMARKER):
                continue
            if token.type == tokenize.NEWLINE:
                logical_start = True
                continue
            if not logical_start:
                continue
            logical_start = False
            row, column = token.start
            if token.type == tokenize.OP and token.string == "@":
                byte_column = len(token.line[:column].encode("utf-8"))
                if pending is None or pending[1] != byte_column:
                    pending = (row, byte_column)
            elif token.type == tokenize.NAME and token.string in ("def", "class", "async"):
                byte_column = len(token.line[:column].encode("utf-8"))
                if pending is not None and pending[1] == byte_column:
                    prefixes[(row, byte_column)] = pending
                pending = None
            else:
                pending = None
    except (tokenize.TokenError, IndentationError):
        # A tokenization mismatch cannot authorize a guessed prefix range.
        return {}
    return prefixes

class Collector(ast.NodeVisitor):
    def __init__(self, prefixes=None):
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
        self.lexical_stack = []
        self.call_omissions = {}
        self.lambda_scopes = 0
        self.declaration_prefixes = prefixes or {}
    def current_func(self):
        return self.lexical_stack[-1]["name"] if self.lexical_stack else "(module)"
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
        entry["scopeId"] = name + "@" + str(node.lineno) + ":" + str(node.col_offset)
        entry["definitionStartLine"] = entry["startLine"]
        entry["definitionStartCol"] = entry["startCol"]
        if getattr(node, "decorator_list", []):
            prefix = self.declaration_prefixes.get((node.lineno, node.col_offset))
            if prefix is not None:
                entry["startLine"], entry["startCol"] = prefix
            else:
                entry["sourceCoverageReason"] = "python_decorator_prefix_unavailable"
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
        return entry["scopeId"]
    def visit_definition_header(self, node):
        # Header observations belong to the surrounding lexical declaration,
        # not to an uncalled function body or the class body being introduced.
        # Calls remain syntactic evidence, including deferred annotations.
        for decorator in getattr(node, "decorator_list", []):
            self.visit(decorator)
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                self.visit(base)
            for keyword in node.keywords:
                self.visit(keyword.value)
        else:
            args = node.args
            for default in args.defaults:
                self.visit(default)
            for default in args.kw_defaults:
                if default is not None:
                    self.visit(default)
            parameters = list(getattr(args, "posonlyargs", [])) + list(args.args) + list(args.kwonlyargs)
            if args.vararg is not None:
                parameters.append(args.vararg)
            if args.kwarg is not None:
                parameters.append(args.kwarg)
            for parameter in parameters:
                if parameter.annotation is not None:
                    self.visit(parameter.annotation)
            if node.returns is not None:
                self.visit(node.returns)
        for parameter in getattr(node, "type_params", []):
            self.visit(parameter)
    def visit_ClassDef(self, node):
        name = node.name
        base = self.lexical_stack[-1]["name"] if self.lexical_stack else ""
        qualified = base + "." + name if base else name
        if not self.func_stack:
            self.exports.add(qualified)
        scope_id = self.record_def(node, "ClassDeclaration", qualified)
        self.visit_definition_header(node)
        self.class_stack.append(name)
        self.scope_stack.append(scope_id)
        self.lexical_stack.append({"name": qualified, "kind": "class"})
        for statement in node.body:
            self.visit(statement)
        self.scope_stack.pop()
        self.lexical_stack.pop()
        self.class_stack.pop()
    def visit_FunctionDef(self, node):
        name = node.name
        base = self.lexical_stack[-1]["name"] if self.lexical_stack else ""
        qualified = base + "." + name if base else name
        is_method = bool(self.lexical_stack) and self.lexical_stack[-1]["kind"] == "class"
        kind = "MethodDeclaration" if is_method else "FunctionDeclaration"
        if not self.func_stack:
            self.exports.add(qualified)
        scope_id = self.record_def(node, kind, qualified)
        self.visit_definition_header(node)
        self.func_stack.append(qualified)
        self.scope_stack.append(scope_id)
        self.lexical_stack.append({"name": qualified, "kind": "function"})
        for statement in node.body:
            self.visit(statement)
        self.scope_stack.pop()
        self.lexical_stack.pop()
        self.func_stack.pop()
    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)
    def visit_Lambda(self, node):
        # Default expressions run when the lambda is created. The body belongs
        # to a later anonymous invocation, never to the surrounding declaration.
        for default in node.args.defaults:
            self.visit(default)
        for default in node.args.kw_defaults:
            if default is not None:
                self.visit(default)
        surrounding = self.current_scope() or "(module)"
        name = self.current_func() + ".<lambda@" + str(node.lineno) + ":" + str(node.col_offset) + ">"
        self.lambda_scopes += 1
        before = len(self.calls)
        self.func_stack.append(name)
        self.scope_stack.append(name)
        self.lexical_stack.append({"name": name, "kind": "lambda"})
        try:
            self.visit(node.body)
        finally:
            self.lexical_stack.pop()
            self.scope_stack.pop()
            self.func_stack.pop()
        omitted = len(self.calls) - before
        if omitted:
            self.call_omissions[surrounding] = self.call_omissions.get(surrounding, 0) + omitted
    def visit_Import(self, node):
        for alias in node.names:
            self.imports.add(alias.name)
            if alias.asname:
                self.usages.add(alias.asname)
    def visit_ImportFrom(self, node):
        module_name = node.module or ""
        if getattr(node, "level", 0):
            module_name = ("." * int(node.level)) + module_name
        if module_name:
            self.imports.add(module_name)
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
            self.call_map.setdefault(self.current_scope() or "(module)", set()).add(callee)
            args = []
            for arg in node.args:
                args.append(format_arg_value(arg))
            for kw in node.keywords:
                if kw.arg:
                    args.append(f"{kw.arg}=" + format_arg_value(kw.value))
                else:
                    args.append("**...")
            self.call_details.append({"caller": caller, "callerScopeId": self.current_scope() or "(module)", "callee": callee, "args": args})
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

def parse_source(source, filename=None, dataflow_flag=True, control_flow_flag=True):
    global dataflow_enabled, control_flow_enabled
    dataflow_enabled = bool(dataflow_flag)
    control_flow_enabled = bool(control_flow_flag)
    try:
        with warnings.catch_warnings():
            # Python 3.12+ emits SyntaxWarning for legacy string escapes (e.g. "\\S")
            # even when code is otherwise parseable; treat these as non-fatal for indexing.
            warnings.filterwarnings("ignore", category=SyntaxWarning, message=r".*invalid escape sequence.*")
            warnings.filterwarnings("ignore", category=DeprecationWarning, message=r".*invalid escape sequence.*")
            tree = ast.parse(source, filename=filename or "<unknown>")
    except Exception as e:
        return {"error": str(e)}
    collector = Collector(declaration_prefixes(source))
    collector.visit(tree)
    for entry in collector.defs:
        calls = collector.call_map.get(entry["scopeId"])
        entry["calls"] = sorted(calls) if calls else []
        omitted = collector.call_omissions.get(entry["scopeId"], 0)
        if omitted:
            entry["callOmissions"] = {"anonymousScopeCalls": omitted, "declarationHeaderCalls": 0}
        flow = collector.flow.get(entry["scopeId"])
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
        "callCoverageReasons": ["anonymous_python_lambda_execution_unmodeled"] if collector.lambda_scopes else [],
        "usages": sorted(collector.usages),
        "exports": sorted(collector.exports)
    }
    return result

def main():
    # Requests are UTF-8 JSON bytes, independently of the host console locale.
    # Responses use json.dumps' ASCII escaping, so that direction is invariant.
    for line in sys.stdin.buffer:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line.decode("utf-8"))
        except Exception as e:
            sys.stdout.write(json.dumps({"id": None, "error": str(e)}) + "\\n")
            sys.stdout.flush()
            continue
        req_id = payload.get("id")
        source = payload.get("text")
        dataflow_flag = to_bool(payload.get("dataflow"), True)
        control_flow_flag = to_bool(payload.get("controlFlow"), True)
        source_path = payload.get("path") or None
        if (source is None or source == "") and source_path:
            try:
                with open(source_path, "r", encoding="utf-8", errors="replace") as fh:
                    source = fh.read()
            except Exception as e:
                sys.stdout.write(json.dumps({"id": req_id, "error": str(e)}) + "\\n")
                sys.stdout.flush()
                continue
        if source is None:
            source = ""
        result = parse_source(source, source_path, dataflow_flag, control_flow_flag)
        sys.stdout.write(json.dumps({"id": req_id, "result": result}) + "\\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
`;
