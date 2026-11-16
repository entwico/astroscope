import type { Rule } from 'eslint';
import type { Node } from 'estree';
import ts from 'typescript';

type TypeServices = {
  program?: ts.Program | null | undefined;
  esTreeNodeToTSNodeMap?: { get(node: Node): ts.Node | undefined } | undefined;
};

export type TypedNames = {
  has(name: string): boolean;
};

// a type that can hold any name: nothing can be called missing from it
function isOpen(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) {
    return type.types.some((member) => isOpen(member, checker));
  }

  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) {
    return true;
  }

  return checker.getIndexInfosOfType(type).length > 0;
}

/**
 * The property names of an expression's type, for an argument the rule cannot read as an object
 * literal. `undefined` without type information or for a type that can hold any name
 * (`any`, `Record<string, …>`, a type parameter).
 */
export function readTypedNames(context: Rule.RuleContext, node: Node): TypedNames | undefined {
  const services = context.sourceCode.parserServices as TypeServices | undefined;
  const program = services?.program;
  const tsNode = services?.esTreeNodeToTSNodeMap?.get(node);

  if (!program || !tsNode) return undefined;

  const checker = program.getTypeChecker();
  const type = checker.getNonNullableType(checker.getTypeAtLocation(tsNode));

  if (isOpen(type, checker)) return undefined;

  // on a union this resolves only the names every member has
  return { has: (name) => checker.getPropertyOfType(type, name) !== undefined };
}
