import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

export interface PluginDocs {
  description: string;
  recommended?: boolean;
  requiresTypeChecking?: boolean;
}

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

const PRIMITIVE_FLAGS =
  ts.TypeFlags.String |
  ts.TypeFlags.Number |
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BigInt |
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.BigIntLiteral |
  ts.TypeFlags.EnumLiteral |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never |
  ts.TypeFlags.ESSymbol;

function isPrimitive(type: ts.Type): boolean {
  return (type.flags & PRIMITIVE_FLAGS) !== 0;
}

function isAnyOrUnknown(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
}

function hasIndexSignature(type: ts.Type): boolean {
  return type.getStringIndexType() !== undefined || type.getNumberIndexType() !== undefined;
}

function isOpaque(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (isAnyOrUnknown(type)) return true;
  if (isPrimitive(type)) return true;
  if (checker.isArrayType(type)) return false;
  if (hasIndexSignature(type)) return true;
  if (type.getCallSignatures().length > 0) return true;

  return false;
}

function resolveTypeParameter(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  if (!(type.flags & ts.TypeFlags.TypeParameter)) return type;

  const constraint = checker.getBaseConstraintOfType(type);

  if (!constraint || isOpaque(constraint, checker)) return null;

  return constraint;
}

function constituents(type: ts.Type): ts.Type[] {
  if (type.isUnion()) return type.types.flatMap(constituents);

  return [type];
}

const allowedKeysCache = new WeakMap<ts.Type, Set<string> | null>();

function collectAllowedKeys(type: ts.Type): Set<string> | null {
  if (allowedKeysCache.has(type)) return allowedKeysCache.get(type) ?? null;

  for (const c of constituents(type)) {
    if (isAnyOrUnknown(c) || hasIndexSignature(c)) {
      allowedKeysCache.set(type, null);

      return null;
    }
  }

  const keys = new Set<string>();

  for (const c of constituents(type)) {
    for (const prop of c.getProperties()) keys.add(prop.name);
  }

  allowedKeysCache.set(type, keys);

  return keys;
}

function getDeclaredPropType(checker: ts.TypeChecker, type: ts.Type, name: string, node: ts.Node): ts.Type | null {
  for (const c of constituents(type)) {
    const prop = c.getProperty(name);

    if (prop) return checker.getTypeOfSymbolAtLocation(prop, node);
  }

  return null;
}

function getArrayElementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
  if (!checker.isArrayType(type)) return null;

  const args = checker.getTypeArguments(type as ts.TypeReference);

  return args[0] ?? null;
}

function isLiteralType(type: ts.Type): boolean {
  return !!(type.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral));
}

function isLiteralOrUnionOfLiterals(type: ts.Type): boolean {
  if (isLiteralType(type)) return true;
  if (type.isUnion()) return type.types.every(isLiteralType);

  return false;
}

function getLiteralValue(type: ts.Type): string {
  if (type.isStringLiteral()) return JSON.stringify(type.value);
  if (type.isNumberLiteral()) return String(type.value);
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as unknown as { intrinsicName: string }).intrinsicName === 'true' ? 'true' : 'false';
  }

  return JSON.stringify(String(type));
}

function literalContains(branchPropType: ts.Type, value: string): boolean {
  if (isLiteralType(branchPropType)) return getLiteralValue(branchPropType) === value;
  if (branchPropType.isUnion()) {
    return branchPropType.types.some((t) => isLiteralType(t) && getLiteralValue(t) === value);
  }

  return false;
}

function findDiscriminant(union: ts.UnionType, checker: ts.TypeChecker, site: ts.Node): string | null {
  if (union.types.length < 2) return null;

  const firstMember = union.types[0];

  if (!firstMember) return null;

  for (const prop of firstMember.getProperties()) {
    if (!isLiteralOrUnionOfLiterals(checker.getTypeOfSymbolAtLocation(prop, site))) continue;

    const allHaveLiteral = union.types.every((member) => {
      const memberProp = member.getProperty(prop.name);

      return memberProp ? isLiteralOrUnionOfLiterals(checker.getTypeOfSymbolAtLocation(memberProp, site)) : false;
    });

    if (allHaveLiteral) return prop.name;
  }

  return null;
}

function narrowByDiscriminant(expected: ts.Type, actual: ts.Type, checker: ts.TypeChecker, site: ts.Node): ts.Type {
  if (!expected.isUnion()) return expected;

  const disc = findDiscriminant(expected, checker, site);

  if (!disc) return expected;

  const actualValues = new Set<string>();

  for (const c of constituents(actual)) {
    const prop = c.getProperty(disc);

    if (!prop) continue;

    const propType = checker.getTypeOfSymbolAtLocation(prop, site);

    // the actual discriminant may be a single literal or a union of literals (e.g. 'grid' | 'carousel');
    // anything else can't pick a branch
    if (isLiteralType(propType)) {
      actualValues.add(getLiteralValue(propType));
    } else if (propType.isUnion() && propType.types.every(isLiteralType)) {
      for (const member of propType.types) actualValues.add(getLiteralValue(member));
    } else {
      return expected;
    }

    break;
  }

  if (actualValues.size === 0) return expected;

  const matches = expected.types.filter((branch) => {
    const bp = branch.getProperty(disc);

    if (!bp) return false;

    const bpType = checker.getTypeOfSymbolAtLocation(bp, site);

    return [...actualValues].some((value) => literalContains(bpType, value));
  });

  return matches.length === 1 ? matches[0]! : expected;
}

function resolveComponentType(checker: ts.TypeChecker, tsTagNode: ts.Node): ts.Type | null {
  const direct = checker.getTypeAtLocation(tsTagNode);

  if (direct.getCallSignatures().length > 0) return direct;

  const rawSymbol = checker.getSymbolAtLocation(tsTagNode);

  if (!rawSymbol) return null;

  const symbol = rawSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(rawSymbol) : rawSymbol;
  const viaSymbol = checker.getTypeOfSymbolAtLocation(symbol, tsTagNode);

  return viaSymbol.getCallSignatures().length > 0 ? viaSymbol : null;
}

function resolvePropsType(checker: ts.TypeChecker, tsTagNode: ts.Node): ts.Type | null {
  const componentType = resolveComponentType(checker, tsTagNode);

  if (!componentType) return null;

  const firstSignature = componentType.getCallSignatures()[0];

  if (!firstSignature) return null;

  const paramSymbol = firstSignature.getParameters()[0];

  if (!paramSymbol) return null;

  return checker.getTypeOfSymbolAtLocation(paramSymbol, tsTagNode);
}

function formatPath(segments: string[]): string {
  let out = '';

  for (const seg of segments) {
    if (seg === '[]') out += '[]';
    else if (out === '') out = seg;
    else out += `.${seg}`;
  }

  return out;
}

function hasSeen(seen: Map<ts.Type, Set<ts.Type>>, expected: ts.Type, actual: ts.Type): boolean {
  return seen.get(expected)?.has(actual) === true;
}

function markSeen(seen: Map<ts.Type, Set<ts.Type>>, expected: ts.Type, actual: ts.Type): void {
  let set = seen.get(expected);

  if (!set) {
    set = new Set();
    seen.set(expected, set);
  }

  set.add(actual);
}

function unmarkSeen(seen: Map<ts.Type, Set<ts.Type>>, expected: ts.Type, actual: ts.Type): void {
  const set = seen.get(expected);

  if (!set) return;

  set.delete(actual);
  if (set.size === 0) seen.delete(expected);
}

function walkExcess(
  expected: ts.Type,
  actual: ts.Type,
  path: string[],
  seen: Map<ts.Type, Set<ts.Type>>,
  out: string[],
  checker: ts.TypeChecker,
  site: ts.Node,
): void {
  // walk type parameter's base constraint if any (`T extends X` → walk `X`); unconstrained → bail
  const resolved = resolveTypeParameter(expected, checker);

  if (resolved === null) return;
  expected = resolved;

  if (isOpaque(expected, checker)) return;

  // identity short-circuit: same type object → shapes identical, no excess possible
  if (expected === actual) return;

  // pair-based cycle guard: stop only when the same (expected, actual) pair reappears
  if (hasSeen(seen, expected, actual)) return;

  markSeen(seen, expected, actual);

  try {
    // arrays: descend into element types, under one '[]' path segment
    const expectedElement = getArrayElementType(expected, checker);

    if (expectedElement) {
      const actualElement = getArrayElementType(actual, checker);

      if (actualElement) {
        walkExcess(expectedElement, actualElement, [...path, '[]'], seen, out, checker, site);
      }

      return;
    }

    // narrow & compare per actual constituent so each element narrows independently
    for (const actualConstituent of constituents(actual)) {
      if (isOpaque(actualConstituent, checker)) continue;

      // narrow to matching branch via discriminant literal, or fall back to permissive
      const narrowedExpected = narrowByDiscriminant(expected, actualConstituent, checker, site);
      const allowed = collectAllowedKeys(narrowedExpected);

      if (allowed === null) continue;

      for (const prop of actualConstituent.getProperties()) {
        if (!allowed.has(prop.name)) {
          // skip TS-synthesized placeholders: `prop?: undefined` / `prop?: never` fillers
          const propType = checker.getTypeOfSymbolAtLocation(prop, site);
          const onlyUndefinedOrNever =
            (propType.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)) !== 0 && !propType.isUnion();

          if (onlyUndefinedOrNever) continue;

          out.push(formatPath([...path, prop.name]));
          continue;
        }

        const declaredSub = getDeclaredPropType(checker, narrowedExpected, prop.name, site);

        if (!declaredSub) continue;

        const actualSub = checker.getTypeOfSymbolAtLocation(prop, site);

        walkExcess(declaredSub, actualSub, [...path, prop.name], seen, out, checker, site);
      }
    }
  } finally {
    unmarkSeen(seen, expected, actual);
  }
}

function collectExcessPaths(
  expected: ts.Type,
  actual: ts.Type,
  rootPath: string[],
  checker: ts.TypeChecker,
  site: ts.Node,
): string[] {
  const out: string[] = [];

  walkExcess(expected, actual, rootPath, new Map(), out, checker, site);

  // de-dup (nested unions can surface the same excess multiple times)
  return [...new Set(out)].sort();
}

export const noExcessJsxProps = createRule({
  name: 'no-excess-jsx-props',
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow passing excess properties to hydrated Astro islands (JSX elements with a `client:*` directive). SSR-only components are not checked because their props never serialize to the browser.',
      requiresTypeChecking: true,
    },
    messages: {
      excessProps:
        'excess propert{{s}} {{names}} flow{{v}} into <{{comp}}> — declared prop type does not include {{them}}',
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

    function report(node: TSESTree.JSXSpreadAttribute | TSESTree.JSXAttribute, excess: string[], compName: string) {
      if (excess.length === 0) return;

      const multi = excess.length > 1;

      context.report({
        node,
        messageId: 'excessProps',
        data: {
          s: multi ? 'ies' : 'y',
          v: multi ? '' : 's',
          them: multi ? 'them' : 'it',
          names: excess.map((n) => `'${n}'`).join(', '),
          comp: compName,
        },
      });
    }

    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const tag = node.name;

        if (tag.type !== 'JSXIdentifier') return;
        // lowercase → intrinsic HTML element, not our surface
        if (/^[a-z]/.test(tag.name)) return;

        // SSR-only components never serialize props to the browser
        // only client: matters for hydration
        const hydrated = node.attributes.some(
          (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXNamespacedName' && a.name.namespace.name === 'client',
        );

        if (!hydrated) return;

        const tsTagNode = services.esTreeNodeToTSNodeMap.get(tag);
        const propsType = resolvePropsType(checker, tsTagNode);

        if (!propsType) return;

        for (const attr of node.attributes) {
          if (attr.type === 'JSXSpreadAttribute') {
            const tsArg = services.esTreeNodeToTSNodeMap.get(attr.argument);
            const argType = checker.getTypeAtLocation(tsArg);
            const excess = collectExcessPaths(propsType, argType, [], checker, tsTagNode);

            report(attr, excess, tag.name);
            continue;
          }

          if (attr.value?.type !== 'JSXExpressionContainer') continue;

          const attrName = attr.name.type === 'JSXIdentifier' ? attr.name.name : null;

          if (!attrName) continue;

          const declaredSub = getDeclaredPropType(checker, propsType, attrName, tsTagNode);

          if (!declaredSub) continue;

          const tsExpr = services.esTreeNodeToTSNodeMap.get(attr.value.expression);
          const actualSub = checker.getTypeAtLocation(tsExpr);
          const excess = collectExcessPaths(declaredSub, actualSub, [attrName], checker, tsTagNode);

          report(attr, excess, tag.name);
        }
      },
    };
  },
});
