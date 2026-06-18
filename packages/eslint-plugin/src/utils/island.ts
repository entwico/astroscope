import type { TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

export interface PluginDocs {
  description: string;
  recommended?: boolean;
  requiresTypeChecking?: boolean;
}

/** A `client:*` directive is an Astro namespaced JSX attribute marking a hydrated island. */
export function isClientDirective(attr: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute): boolean {
  return (
    attr.type === 'JSXAttribute' && attr.name.type === 'JSXNamespacedName' && attr.name.namespace.name === 'client'
  );
}

/** Whether a JSX opening element is a hydrated island: capitalized tag + a `client:*` directive. */
export function isIslandElement(node: TSESTree.JSXOpeningElement): node is TSESTree.JSXOpeningElement & {
  name: TSESTree.JSXIdentifier;
} {
  const tag = node.name;

  // lowercase → intrinsic HTML element, not a component
  if (tag.type !== 'JSXIdentifier' || /^[a-z]/.test(tag.name)) {
    return false;
  }

  return node.attributes.some(isClientDirective);
}

function resolveComponentType(checker: ts.TypeChecker, tsTagNode: ts.Node): ts.Type | null {
  const direct = checker.getTypeAtLocation(tsTagNode);

  if (direct.getCallSignatures().length > 0) {
    return direct;
  }

  const rawSymbol = checker.getSymbolAtLocation(tsTagNode);

  if (!rawSymbol) {
    return null;
  }

  const symbol = rawSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(rawSymbol) : rawSymbol;
  const viaSymbol = checker.getTypeOfSymbolAtLocation(symbol, tsTagNode);

  return viaSymbol.getCallSignatures().length > 0 ? viaSymbol : null;
}

/** Resolve the declared props type (first parameter) of the component a JSX tag refers to. */
export function resolvePropsType(checker: ts.TypeChecker, tsTagNode: ts.Node): ts.Type | null {
  const componentType = resolveComponentType(checker, tsTagNode);

  if (!componentType) {
    return null;
  }

  const firstSignature = componentType.getCallSignatures()[0];
  const paramSymbol = firstSignature?.getParameters()[0];

  if (!paramSymbol) {
    return null;
  }

  return checker.getTypeOfSymbolAtLocation(paramSymbol, tsTagNode);
}
