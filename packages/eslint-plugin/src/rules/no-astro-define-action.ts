import type { Rule } from 'eslint';
import type { ImportDeclaration, ImportSpecifier, Node } from 'estree';
import {
  type Linked,
  type WithExportKind,
  type WithImportKind,
  importExpressionSource,
  memberName,
  memberOff,
} from '../utils/ast.js';

const DEFAULT_SOURCE = '@astroscope/node/guards';
const ASTRO_ACTIONS = 'astro:actions';

type Options = [{ source?: string | undefined }?];

/**
 * `defineAction` from `astro:actions` has no place for guards, so an action defined with it is
 * unguarded by construction and nothing in the type system says so. The platform's
 * `defineAction` takes `guards` and narrows `locals` for the handler; every action goes through
 * it, guarded or not, so the only difference between the two is whether protection is possible.
 * The other `astro:actions` exports (`ActionError`, `getActionContext`, `actions`) stay legal, and
 * so are type-only imports — a type cannot define an action. Besides the named import the rule
 * sees the module's `defineAction` reached through a namespace import, a dynamic `import()` and a
 * re-export (which hands the unguarded one to every importer); only the named import is fixed.
 */
export const noAstroDefineAction: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require the platform `defineAction` (with guards) instead of the one from `astro:actions`',
    },
    messages: {
      astroDefineAction:
        '`defineAction` from `astro:actions` cannot take guards. Import it from `{{source}}` instead, which accepts `guards` and narrows `locals` for the handler.',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          source: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const source = (context.options as Options)[0]?.source ?? DEFAULT_SOURCE;
    const report = (node: Node, fix?: Rule.ReportFixer): void => {
      context.report({ node, messageId: 'astroDefineAction', data: { source }, ...(fix && { fix }) });
    };

    // bindings holding the whole module: `import * as ns` and `const ns = await import()`
    const namespaces: Node[] = [];

    const reportModuleReads = (binding: Node): void => {
      for (const variable of context.sourceCode.getDeclaredVariables(binding)) {
        for (const reference of variable.references) {
          const member = memberOff(reference.identifier as Linked);

          if (member && memberName(member) === 'defineAction') {
            report(member);
          }
        }
      }
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== ASTRO_ACTIONS) return;
        if ((node as WithImportKind).importKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.push(specifier);
          }
        }

        const specifier = node.specifiers.find(
          (candidate): candidate is ImportSpecifier =>
            candidate.type === 'ImportSpecifier' &&
            (candidate as WithImportKind).importKind !== 'type' &&
            candidate.imported.type === 'Identifier' &&
            candidate.imported.name === 'defineAction',
        );

        if (!specifier) return;

        report(specifier, (fixer) => fix(fixer, node, specifier, source, context.sourceCode));
      },

      ExportNamedDeclaration(node) {
        if (node.source?.value !== ASTRO_ACTIONS) return;
        if ((node as WithExportKind).exportKind === 'type') return;

        for (const specifier of node.specifiers) {
          if (
            (specifier as WithExportKind).exportKind !== 'type' &&
            specifier.local.type === 'Identifier' &&
            specifier.local.name === 'defineAction'
          ) {
            report(specifier);
          }
        }
      },

      ExportAllDeclaration(node) {
        if (node.source.value !== ASTRO_ACTIONS) return;
        if ((node as WithExportKind).exportKind === 'type') return;

        report(node);
      },

      ImportExpression(node) {
        if (importExpressionSource(node as Linked) !== ASTRO_ACTIONS) return;

        const parent = (node as Linked).parent;
        const value = parent?.type === 'AwaitExpression' ? parent : (node as Linked);
        const holder = value.parent;

        // `(await import('astro:actions')).defineAction`
        const member = memberOff(value);

        if (member) {
          if (memberName(member) === 'defineAction') report(member);

          return;
        }

        if (holder?.type !== 'VariableDeclarator' || holder.init !== value) return;

        // `const { defineAction } = await import('astro:actions')`
        if (holder.id.type === 'ObjectPattern') {
          for (const property of holder.id.properties) {
            if (property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'defineAction') {
              report(property);
            }
          }

          return;
        }

        // `const ns = await import('astro:actions')` reads like a namespace import
        if (holder.id.type === 'Identifier') {
          namespaces.push(holder);
        }
      },

      // references are inspected after the full AST is traversed, so parent links exist
      'Program:exit'() {
        for (const namespace of namespaces) {
          reportModuleReads(namespace);
        }
      },
    };
  },
};

function fix(
  fixer: Rule.RuleFixer,
  declaration: ImportDeclaration,
  specifier: ImportSpecifier,
  source: string,
  sourceCode: Rule.RuleContext['sourceCode'],
): Rule.Fix | null {
  const quote = sourceCode.getText(declaration.source).startsWith('"') ? '"' : '\'';
  const attributes = declaration.attributes.length > 0
    ? ` with { ${declaration.attributes.map((attribute) => sourceCode.getText(attribute as unknown as Node)).join(', ')} }`
    : '';
  const replacement = `import { ${sourceCode.getText(specifier)} } from ${quote}${source}${quote}${attributes};`;

  if (declaration.specifiers.length === 1) {
    return fixer.replaceText(declaration, replacement);
  }

  const others = declaration.specifiers.filter((candidate) => candidate !== specifier);

  // a mixed import keeps the other specifiers; a default or namespace specifier cannot sit in
  // the braces, and it never appears together with named ones on `astro:actions`
  if (others.some((candidate) => candidate.type !== 'ImportSpecifier')) {
    return null;
  }

  const kept = `import { ${others.map((candidate) => sourceCode.getText(candidate)).join(', ')} } from ${quote}astro:actions${quote}${attributes};`;

  return fixer.replaceText(declaration, `${replacement}\n${kept}`);
}
