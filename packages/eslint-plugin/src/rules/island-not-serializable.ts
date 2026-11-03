import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

import { type PluginDocs, isIslandElement, resolvePropsType, tagName } from '../utils/island.js';

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

// directly serializable as plain JSON-ish data
const SERIALIZABLE_PRIMITIVE_FLAGS =
  ts.TypeFlags.String
  | ts.TypeFlags.Number
  | ts.TypeFlags.Boolean
  | ts.TypeFlags.StringLiteral
  | ts.TypeFlags.NumberLiteral
  | ts.TypeFlags.BooleanLiteral
  | ts.TypeFlags.EnumLiteral
  | ts.TypeFlags.Enum
  | ts.TypeFlags.Null
  | ts.TypeFlags.Undefined;

// can't be decided — skip rather than risk a false positive
const UNDECIDABLE_FLAGS = ts.TypeFlags.Any | ts.TypeFlags.Unknown;

// a props type nested deeper than this is left undecided rather than walked further: a generic
// that instantiates a fresh type on every level (`type Deep<T> = { next: Deep<[T]> }`) never
// repeats an identity, so without a bound the walk would not terminate
const MAX_DEPTH = 32;

// not representable in JSON
const NON_SERIALIZABLE_PRIMITIVE_FLAGS =
  ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol;

function constituents(type: ts.Type): ts.Type[] {
  return type.isUnion() ? type.types.flatMap((member) => constituents(member)) : [type];
}

function isTupleType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Object) !== 0 && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple) !== 0;
}

function resolveTypeParameter(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  if ((type.flags & ts.TypeFlags.TypeParameter) === 0) {
    return type;
  }

  // unconstrained type parameter → can't decide
  return checker.getBaseConstraintOfType(type) ?? null;
}

function hasCallLikeProperty(type: ts.Type, checker: ts.TypeChecker, site: ts.Node): boolean {
  return type.getProperties().some((prop) => {
    const propType = checker.getTypeOfSymbolAtLocation(prop, site);

    return propType.getCallSignatures().length > 0 || propType.getConstructSignatures().length > 0;
  });
}

// the declaration a generic instantiation comes from: the alias of `Deep<[T]>` or the target of
// `Box<T>`; a type whose declaration is already on the current path is recursing on itself
function declarationOf(type: ts.Type): ts.Symbol | undefined {
  if (type.aliasSymbol) {
    return type.aliasSymbol;
  }

  const objectFlags = (type as ts.ObjectType).objectFlags ?? 0;

  return (objectFlags & ts.ObjectFlags.Reference) === 0 ? undefined : (type as ts.TypeReference).target.symbol;
}

function joinPath(path: string[]): string {
  let out = '';

  for (const seg of path) {
    if (seg === '[]') out += '[]';
    else if (out === '') out = seg;
    else out += `.${seg}`;
  }

  return out;
}

interface Walk {
  seen: Set<ts.Type>;
  lineage: ts.Symbol[];
  out: Set<string>;
  checker: ts.TypeChecker;
  site: ts.Node;
}

function walk(type: ts.Type, path: string[], { seen, lineage, out, checker, site }: Walk): void {
  if (path.length > MAX_DEPTH) {
    return;
  }

  const resolved = resolveTypeParameter(type, checker);

  if (resolved === null) {
    return;
  }

  type = resolved;

  const state: Walk = { seen, lineage, out, checker, site };

  if (type.isUnion()) {
    for (const member of type.types) {
      walk(member, path, state);
    }

    return;
  }

  // an intersection's value carries every member's properties; walking each
  // constituent covers the merged shape and reuses all object/array/index logic
  if (type.isIntersection()) {
    for (const member of type.types) {
      walk(member, path, state);
    }

    return;
  }

  if ((type.flags & UNDECIDABLE_FLAGS) !== 0 || (type.flags & ts.TypeFlags.Never) !== 0) {
    return;
  }

  if ((type.flags & SERIALIZABLE_PRIMITIVE_FLAGS) !== 0) {
    return;
  }

  if ((type.flags & NON_SERIALIZABLE_PRIMITIVE_FLAGS) !== 0) {
    out.add(joinPath(path));

    return;
  }

  // functions / classes / constructors
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
    out.add(joinPath(path));

    return;
  }

  // arrays and tuples: descend into element types under one '[]' segment
  if (checker.isArrayType(type) || isTupleType(type)) {
    for (const element of checker.getTypeArguments(type as ts.TypeReference)) {
      walk(element, [...path, '[]'], state);
    }

    return;
  }

  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    if (seen.has(type)) {
      return;
    }

    seen.add(type);

    const declaration = declarationOf(type);

    if (declaration && lineage.includes(declaration)) {
      return;
    }

    // a method/function-valued property means this is class-like (Date, URL, Map, …) — report it whole
    if (hasCallLikeProperty(type, checker, site)) {
      out.add(joinPath(path));

      return;
    }

    const nested: Walk = { ...state, lineage: declaration ? [...lineage, declaration] : lineage };

    const indexType = type.getStringIndexType() ?? type.getNumberIndexType();

    if (indexType) {
      walk(indexType, [...path, '[]'], nested);
    }

    for (const prop of type.getProperties()) {
      walk(checker.getTypeOfSymbolAtLocation(prop, site), [...path, prop.name], nested);
    }

    return;
  }

  // anything else (e.g. intrinsic non-serializable) → not safe
  out.add(joinPath(path));
}

export const islandNotSerializable = createRule<[], 'notSerializable'>({
  name: 'island-not-serializable',
  meta: {
    type: 'problem',
    docs: {
      description:
        'require props of a hydrated island (a `client:*` component) to be directly serializable plain data — no functions, symbols, bigints, or class instances (Date, URL, RegExp, Map, …).',
      requiresTypeChecking: true,
    },
    messages: {
      notSerializable:
        'island <{{comp}}> prop {{names}} {{v}} not directly serializable — only primitives, plain objects, and arrays cross the island boundary intact.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    let services: ReturnType<typeof ESLintUtils.getParserServices>;

    try {
      services = ESLintUtils.getParserServices(context);
    } catch {
      return {};
    }

    const checker = services.program.getTypeChecker();

    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        if (!isIslandElement(node)) {
          return;
        }

        const tag = node.name;
        const tsTagNode = services.esTreeNodeToTSNodeMap.get(tag);
        const propsType = resolvePropsType(checker, tsTagNode);

        if (!propsType) {
          return;
        }

        const out = new Set<string>();

        for (const branch of constituents(propsType)) {
          for (const prop of branch.getProperties()) {
            // children arrive as slots, not serialized props
            if (prop.name === 'children') {
              continue;
            }

            walk(checker.getTypeOfSymbolAtLocation(prop, tsTagNode), [prop.name], {
              seen: new Set(),
              lineage: [],
              out,
              checker,
              site: tsTagNode,
            });
          }
        }

        const names = [...out].toSorted((a, b) => a.localeCompare(b));

        if (names.length === 0) {
          return;
        }

        context.report({
          node: tag,
          messageId: 'notSerializable',
          data: {
            comp: tagName(tag),
            names: names.map((n) => `'${n}'`).join(', '),
            v: names.length > 1 ? 'are' : 'is',
          },
        });
      },
    };
  },
});
