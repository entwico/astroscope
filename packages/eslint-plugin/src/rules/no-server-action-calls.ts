import type { Rule } from 'eslint';
import type { Node } from 'estree';
import { type Linked, callOf, memberName, memberOff } from '../utils/ast.js';

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
 * `Astro.getActionResult()` is the intended server-side usage. The registry is
 * followed through its named import and through a namespace import of
 * `astro:actions`; typescript wrappers (`actions.like!()`, `(actions.like as
 * any)()`) and computed members with a static key read like the plain form.
 * `callAction` is reported wherever it is read off `Astro`, a call or not,
 * since any other read (`const { callAction } = Astro`) only serves a call.
 */

// climbs a member chain (`actions.blog.comment.like`) to its outermost access
function outermostMember(node: Linked): Linked {
  let chain = node;

  for (let next = memberOff(chain); next; next = memberOff(chain)) {
    chain = next;
  }

  return chain;
}
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
        '`Astro.callAction()` runs the action handler during server rendering — the mutation fires on plain GET renders without the action endpoint\'s POST-only and origin checks, and the page becomes coupled to the controller. Move the shared logic into its own module and call it from both the action handler and the astro code.',
    },
    schema: [],
  },
  create(context) {
    if (!context.filename.endsWith('.astro')) return {};

    const registries: Node[] = [];
    const namespaces: Node[] = [];

    const reportCallsOn = (registry: Linked): void => {
      const call = callOf(outermostMember(registry));

      if (call) {
        context.report({ node: call, messageId: 'directCall' });
      }
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'astro:actions') return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.push(specifier);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'actions'
          ) {
            registries.push(specifier);
          }
        }
      },

      MemberExpression(node) {
        if (node.object.type !== 'Identifier' || node.object.name !== 'Astro') return;
        if (memberName(node as Linked) !== 'callAction') return;

        context.report({ node: callOf(node as Linked) ?? node, messageId: 'callAction' });
      },

      // `const { callAction } = Astro`
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern' || node.init?.type !== 'Identifier' || node.init.name !== 'Astro') return;

        for (const property of node.id.properties) {
          if (property.type === 'Property' && property.key.type === 'Identifier' && property.key.name === 'callAction') {
            context.report({ node: property, messageId: 'callAction' });
          }
        }
      },

      // references are inspected after the full AST is traversed, so parent links exist
      'Program:exit'() {
        for (const specifier of registries) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              reportCallsOn(reference.identifier as Linked);
            }
          }
        }

        for (const specifier of namespaces) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const registry = memberOff(reference.identifier as Linked);

              if (registry && memberName(registry) === 'actions') {
                reportCallsOn(registry);
              }
            }
          }
        }
      },
    };
  },
};
