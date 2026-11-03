import type { Node } from 'estree';

/** estree nodes carry eslint's parent link at runtime */
export type Linked = Node & { parent?: Linked | undefined };

// typescript-eslint adds `importKind` / `exportKind` to estree's module nodes
export type WithImportKind = { importKind?: 'type' | 'value' | undefined };
export type WithExportKind = { exportKind?: 'type' | 'value' | undefined };

// typescript expression wrappers that leave the runtime value untouched (`x!`, `x as T`, `x satisfies T`, `<T>x`)
const TS_WRAPPERS = new Set(['TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion']);

/** The static name of a member access: `a.b`, `a['b']`, or null for a dynamic key. */
export function memberName(node: Linked): string | null {
  if (node.type !== 'MemberExpression') return null;

  if (!node.computed) {
    return node.property.type === 'Identifier' ? node.property.name : null;
  }

  if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }

  if (node.property.type === 'TemplateLiteral' && node.property.expressions.length === 0) {
    return node.property.quasis[0]?.value.cooked ?? null;
  }

  return null;
}

/** Climbs out of the typescript wrappers around a node, so `a!.b` and `(a as T).b` read like `a.b`. */
export function unwrapOutward(node: Linked): Linked {
  let current = node;

  while (current.parent && TS_WRAPPERS.has(current.parent.type)) {
    if ((current.parent as { expression?: Node }).expression !== current) break;

    current = current.parent;
  }

  return current;
}

/** The member access whose object is this node (through typescript wrappers), or null. */
export function memberOff(node: Linked): Linked | null {
  const base = unwrapOutward(node);
  const parent = base.parent;

  return parent?.type === 'MemberExpression' && parent.object === base ? parent : null;
}

/** The call whose callee is this node (through typescript wrappers), or null. */
export function callOf(node: Linked): Linked | null {
  const callee = unwrapOutward(node);
  const parent = callee.parent;

  return parent?.type === 'CallExpression' && parent.callee === callee ? parent : null;
}

/** The literal module specifier of an `import()` expression, or null when it is dynamic. */
export function importExpressionSource(node: Linked): string | null {
  if (node.type !== 'ImportExpression') return null;

  if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
    return node.source.value;
  }

  if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) {
    return node.source.quasis[0]?.value.cooked ?? null;
  }

  return null;
}
