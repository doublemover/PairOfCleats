import { findDescendantByType } from './ast.js';

const LANGUAGE_WASM_FILES = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  json: 'tree-sitter-json.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm',
  markdown: 'tree-sitter-markdown.wasm',
  swift: 'tree-sitter-swift.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  clike: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  objc: 'tree-sitter-objc.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm'
};

export const TREE_SITTER_LANGUAGE_IDS = Object.freeze(
  Object.keys(LANGUAGE_WASM_FILES)
);

const JS_TS_CONFIG = {
  typeNodes: new Set([
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration'
  ]),
  memberNodes: new Set([
    'function_declaration',
    'method_definition'
  ]),
  nameFields: ['name'],
  kindMap: {
    class_declaration: 'ClassDeclaration',
    interface_declaration: 'InterfaceDeclaration',
    type_alias_declaration: 'TypeAlias',
    enum_declaration: 'EnumDeclaration',
    function_declaration: 'FunctionDeclaration',
    method_definition: 'MethodDeclaration'
  },
  docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
};

const LANG_CONFIG = {
  javascript: JS_TS_CONFIG,
  typescript: JS_TS_CONFIG,
  tsx: JS_TS_CONFIG,
  jsx: JS_TS_CONFIG,
  python: {
    typeNodes: new Set(['class_definition']),
    memberNodes: new Set(['function_definition']),
    kindMap: {
      class_definition: 'ClassDeclaration',
      function_definition: 'FunctionDeclaration'
    },
    docComments: { linePrefixes: ['#'] },
    nameFields: ['name']
  },
  json: {
    typeNodes: new Set(['pair']),
    memberNodes: new Set([]),
    kindMap: { pair: 'ConfigEntry' },
    nameFields: ['key']
  },
  yaml: {
    typeNodes: new Set(['block_mapping_pair', 'flow_pair']),
    memberNodes: new Set([]),
    kindMap: {
      block_mapping_pair: 'ConfigEntry',
      flow_pair: 'ConfigEntry'
    },
    nameFields: ['key'],
    docComments: { linePrefixes: ['#'] }
  },
  toml: {
    typeNodes: new Set(['pair']),
    memberNodes: new Set([]),
    kindMap: { pair: 'ConfigEntry' },
    nameFields: ['key']
  },
  markdown: {
    typeNodes: new Set(['atx_heading', 'setext_heading']),
    memberNodes: new Set([]),
    kindMap: {
      atx_heading: 'Section',
      setext_heading: 'Section'
    },
    resolveName: (node, rawText) => {
      if (!node || typeof rawText !== 'string') return null;
      if (node.type === 'atx_heading') {
        const raw = rawText.slice(node.startIndex, node.endIndex);
        const line = raw.split('\n', 1)[0] || '';
        let title = line.trim();
        title = title.replace(/^#{1,6}\s*/, '');
        title = title.replace(/\s*#+\s*$/, '');
        return title.trim();
      }
      if (node.type === 'setext_heading') {
        const raw = rawText.slice(node.startIndex, node.endIndex);
        const firstLine = raw.split('\n', 1)[0] || '';
        return firstLine.trim();
      }
      return null;
    }
  },
  swift: {
    typeNodes: new Set([
      'class_declaration',
      'struct_declaration',
      'enum_declaration',
      'protocol_declaration',
      'extension_declaration',
      'actor_declaration'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'initializer_declaration',
      'deinitializer_declaration',
      'subscript_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      struct_declaration: 'StructDeclaration',
      enum_declaration: 'EnumDeclaration',
      protocol_declaration: 'ProtocolDeclaration',
      extension_declaration: 'ExtensionDeclaration',
      actor_declaration: 'ActorDeclaration',
      function_declaration: 'FunctionDeclaration',
      initializer_declaration: 'Initializer',
      deinitializer_declaration: 'Deinitializer',
      subscript_declaration: 'SubscriptDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'] },
    resolveKind: (node, kind, text) => {
      if (node.type !== 'class_declaration') return kind;
      const head = text.slice(node.startIndex, Math.min(text.length, node.startIndex + 40));
      const match = head.match(/^\s*(struct|class|extension)\b/);
      if (!match) return kind;
      if (match[1] === 'struct') return 'StructDeclaration';
      if (match[1] === 'extension') return 'ExtensionDeclaration';
      return kind;
    }
  },
  kotlin: {
    typeNodes: new Set([
      'class_declaration',
      'object_declaration',
      'interface_declaration',
      'enum_class_body'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'secondary_constructor'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      object_declaration: 'ObjectDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_class_body: 'EnumDeclaration',
      function_declaration: 'FunctionDeclaration',
      secondary_constructor: 'ConstructorDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
  },
  csharp: {
    typeNodes: new Set([
      'class_declaration',
      'struct_declaration',
      'interface_declaration',
      'enum_declaration',
      'record_declaration'
    ]),
    memberNodes: new Set([
      'method_declaration',
      'constructor_declaration',
      'property_declaration',
      'event_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      struct_declaration: 'StructDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_declaration: 'EnumDeclaration',
      record_declaration: 'RecordDeclaration',
      method_declaration: 'MethodDeclaration',
      constructor_declaration: 'ConstructorDeclaration',
      property_declaration: 'PropertyDeclaration',
      event_declaration: 'EventDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'] }
  },
  clike: {
    typeNodes: new Set([
      'struct_specifier',
      'class_specifier',
      'enum_specifier',
      'union_specifier'
    ]),
    memberNodes: new Set([
      'function_definition',
      'function_declaration',
      'method_definition'
    ]),
    kindMap: {
      struct_specifier: 'StructDeclaration',
      class_specifier: 'ClassDeclaration',
      enum_specifier: 'EnumDeclaration',
      union_specifier: 'UnionDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  cpp: {
    typeNodes: new Set([
      'class_specifier',
      'struct_specifier',
      'enum_specifier',
      'union_specifier',
      'namespace_definition'
    ]),
    memberNodes: new Set([
      'function_definition',
      'function_declaration',
      'method_definition'
    ]),
    kindMap: {
      class_specifier: 'ClassDeclaration',
      struct_specifier: 'StructDeclaration',
      enum_specifier: 'EnumDeclaration',
      union_specifier: 'UnionDeclaration',
      namespace_definition: 'NamespaceDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  objc: {
    typeNodes: new Set([
      'class_interface',
      'protocol_declaration',
      'category_interface'
    ]),
    memberNodes: new Set([
      'method_definition',
      'method_declaration',
      'function_definition',
      'function_declaration'
    ]),
    kindMap: {
      class_interface: 'ClassDeclaration',
      protocol_declaration: 'ProtocolDeclaration',
      category_interface: 'CategoryDeclaration',
      method_definition: 'MethodDeclaration',
      method_declaration: 'MethodDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  go: {
    typeNodes: new Set([
      'type_spec',
      'type_declaration'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'method_declaration'
    ]),
    kindMap: {
      type_spec: 'TypeDeclaration',
      type_declaration: 'TypeDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_declaration: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] },
    resolveKind: (node, kind) => {
      if (node.type !== 'type_spec' && node.type !== 'type_declaration') return kind;
      const structNode = findDescendantByType(node, new Set(['struct_type']));
      if (structNode) return 'StructDeclaration';
      const ifaceNode = findDescendantByType(node, new Set(['interface_type']));
      if (ifaceNode) return 'InterfaceDeclaration';
      return kind;
    },
    resolveMemberName: (node, name) => {
      if (node.type !== 'method_declaration') return null;
      const receiver = node.childForFieldName('receiver');
      const receiverType = findDescendantByType(receiver, new Set(['type_identifier']));
      if (!receiverType) return null;
      return { name: `${receiverType.text}.${name}` };
    }
  },
  rust: {
    typeNodes: new Set([
      'struct_item',
      'enum_item',
      'trait_item',
      'impl_item',
      'mod_item'
    ]),
    memberNodes: new Set([
      'function_item',
      'function_definition',
      'method_definition',
      'macro_definition'
    ]),
    kindMap: {
      struct_item: 'StructDeclaration',
      enum_item: 'EnumDeclaration',
      trait_item: 'TraitDeclaration',
      impl_item: 'ImplDeclaration',
      mod_item: 'ModuleDeclaration',
      function_item: 'FunctionDeclaration',
      function_definition: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration',
      macro_definition: 'MacroDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] },
    nameFields: ['name', 'type']
  },
  java: {
    typeNodes: new Set([
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'record_declaration'
    ]),
    memberNodes: new Set([
      'method_declaration',
      'constructor_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_declaration: 'EnumDeclaration',
      record_declaration: 'RecordDeclaration',
      method_declaration: 'MethodDeclaration',
      constructor_declaration: 'ConstructorDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
  },
  html: {
    typeNodes: new Set([
      'element',
      'script_element',
      'style_element'
    ]),
    memberNodes: new Set([]),
    kindMap: {
      element: 'ElementDeclaration',
      script_element: 'ScriptElement',
      style_element: 'StyleElement'
    },
    nameNodeTypes: new Set(['tag_name'])
  }
};

export { LANGUAGE_WASM_FILES, LANG_CONFIG };
