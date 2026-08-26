import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Astro frontmatter and template expressions run during server rendering — a
 * plain GET page render. Calling an action there executes the mutation on
 * every render, outside the action endpoint's POST-only + origin-checked
 * delivery, and couples the page to the controller: logic needed by both an
 * action and astro code belongs in its own module both can import. A direct
 * `actions.<name>()` call also throws `ActionCalledFromServerError` at
 * runtime; `Astro.callAction()` is Astro's escape hatch around that error and
 * is flagged the same. References that are not calls stay legal: passing
 * `actions.<name>` to a form `action` attribute or to
 * `Astro.getActionResult()` is the intended server-side usage.
 */
export const noServerActionCalls: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid calling actions during server rendering of astro files',
    },
    messages: {
      directCall:
        'actions cannot be called in astro server code — this runs the mutation on every page render and throws `ActionCalledFromServerError` at runtime. Submit via `<form action={actions.<name>}>`, call it from client code, or read the submitted result with `Astro.getActionResult()`.',
      callAction:
        "`Astro.callAction()` runs the action handler during server rendering — the mutation fires on plain GET renders without the action endpoint's POST-only and origin checks, and the page becomes coupled to the controller. Move the shared logic into its own module and call it from both the action handler and the astro code.",
    },
    schema: [],
  },
  create(context) {
    if (!context.filename.endsWith('.astro')) return {};

    const specifiers: Node[] = [];

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'astro:actions') return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'actions'
          ) {
            specifiers.push(specifier);
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;

        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Astro' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'callAction'
        ) {
          context.report({ node, messageId: 'callAction' });
        }
      },

      // references are inspected after the full AST is traversed, so parent links exist
      'Program:exit'() {
        for (const specifier of specifiers) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              // climb the member chain: actions.blog.comment.like → the outermost member expression
              let chain = reference.identifier as Node & { parent?: Node };

              while (chain.parent?.type === 'MemberExpression' && chain.parent.object === chain) {
                chain = chain.parent as Node & { parent?: Node };
              }

              const call = chain.parent;

              if (call?.type === 'CallExpression' && call.callee === chain) {
                context.report({ node: call, messageId: 'directCall' });
              }
            }
          }
        }
      },
    };
  },
};
