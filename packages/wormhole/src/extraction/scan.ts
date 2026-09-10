import { parse } from '@babel/parser';

const PACKAGE_NAME = '@astroscope/wormhole';

/**
 * Which wormhole names a module can reach through the `wormhole` proxy.
 *
 * `wormholes.cart` and `wormholes['cart']` yield names; anything the scan cannot
 * resolve statically — computed access, aliasing the proxy into a variable,
 * namespace imports, re-exports — sets `dynamic`, which the manifest records as
 * `*` (all open wormholes). The failure mode is therefore over-emission, never
 * missing data.
 */
export type WormholeScan = { names: Set<string>; dynamic: boolean };

// type-only subtrees are erased at runtime — identifiers inside them are not accesses
const TYPE_ONLY_NODES = new Set([
  'TSTypeAnnotation',
  'TSTypeParameterDeclaration',
  'TSTypeParameterInstantiation',
  'TSTypeQuery',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function walk(
  node: Node,
  visit: (node: Node, parent: Node | null, key: string) => void,
  parent: Node | null,
  key: string,
): void {
  if (TYPE_ONLY_NODES.has(node.type)) {
    return;
  }

  visit(node, parent, key);

  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === 'loc') {
      continue;
    }

    if (isNode(value)) {
      walk(value, visit, node, childKey);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          walk(item, visit, node, childKey);
        }
      }
    }
  }
}

function isMember(node: Node | null): node is Node {
  return node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression';
}

export function scanWormholeAccess(code: string, id: string): WormholeScan | null {
  const isTs = id.endsWith('.ts') || id.endsWith('.tsx') || id.endsWith('.astro');
  const plugins: ('typescript' | 'jsx')[] = [];

  if (isTs) {
    plugins.push('typescript');
  }

  // compiled astro output is not jsx
  if (!id.endsWith('.ts') && !id.endsWith('.astro')) {
    plugins.push('jsx');
  }

  let program: Node;

  try {
    program = parse(code, { sourceType: 'module', plugins }).program as unknown as Node;
  } catch {
    // an unparseable module that mentions the package cannot be scanned — degrade soundly
    return { names: new Set(), dynamic: true };
  }

  const locals = new Set<string>();
  const scan: WormholeScan = { names: new Set(), dynamic: false };

  for (const statement of program['body'] as Node[]) {
    const source = (statement['source'] as Node | null)?.['value'];

    if (source !== PACKAGE_NAME) {
      continue;
    }

    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement['specifiers'] as Node[]) {
        if (specifier.type === 'ImportSpecifier') {
          const imported = specifier['imported'] as Node;
          const name = imported.type === 'Identifier' ? (imported['name'] as string) : (imported['value'] as string);

          if (name === 'wormholes') {
            locals.add((specifier['local'] as Node)['name'] as string);
          }
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          scan.dynamic = true;
        }
      }
    } else {
      // export { wormhole } from '...' / export * from '...' — accesses happen elsewhere
      scan.dynamic = true;
    }
  }

  if (locals.size === 0 && !scan.dynamic) {
    return null;
  }

  walk(
    program,
    (node, parent, key) => {
      if (node.type !== 'Identifier' || !locals.has(node['name'] as string) || !parent) {
        return;
      }

      if (parent.type === 'ImportSpecifier') {
        return;
      }

      if (isMember(parent) && key === 'object') {
        const property = parent['property'] as Node;

        if (!parent['computed'] && property.type === 'Identifier') {
          scan.names.add(property['name'] as string);
        } else if (parent['computed'] && property.type === 'StringLiteral') {
          scan.names.add(property['value'] as string);
        } else {
          scan.dynamic = true;
        }

        return;
      }

      // a same-named identifier in a non-computed name position cannot reference the proxy value
      if ((key === 'property' || key === 'key') && !(parent['computed'] as boolean)) {
        return;
      }

      // the proxy escapes (aliased, passed, re-exported) — its accesses are untrackable
      scan.dynamic = true;
    },
    null,
    '',
  );

  return scan;
}
