import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

export interface PluginDocs {
  description: string;
  recommended?: boolean;
  requiresTypeChecking?: boolean;
}

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

const DEFAULT_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'self'];

type EqualityOperator = '===' | '!==' | '==' | '!=';

const EQUALITY_OPERATORS: ReadonlySet<string> = new Set<EqualityOperator>(['===', '!==', '==', '!=']);

// true → comparison matches SSR (typeof X === 'undefined' is "we're on the server")
// false → comparison matches client (typeof X !== 'undefined' is "we're in the browser")
const MATCHES_SSR: Record<EqualityOperator, boolean> = {
  '===': true,
  '==': true,
  '!==': false,
  '!=': false,
};

function isUndefinedString(node: TSESTree.Node): boolean {
  return node.type === 'Literal' && node.value === 'undefined';
}

function getTypeofGlobalName(node: TSESTree.Node, globals: ReadonlySet<string>): string | null {
  if (node.type !== 'UnaryExpression' || node.operator !== 'typeof') return null;
  if (node.argument.type !== 'Identifier') return null;
  if (!globals.has(node.argument.name)) return null;

  return node.argument.name;
}

export const preferSsrGuard = createRule<[{ globals?: string[] }?], 'preferSsrGuard'>({
  name: 'prefer-ssr-guard',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'prefer `import.meta.env.SSR` over `typeof window !== "undefined"` (and similar) for SSR/client guards. The Vite-injected constant tree-shakes the dead branch out of the SSR bundle, dropping client-only deps from the server build.',
    },
    messages: {
      preferSsrGuard:
        '`typeof {{global}}` guards are runtime checks. use `{{replacement}}` instead — Vite inlines it at build time so the dead branch (and its imports) drops from the SSR bundle.',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          globals: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const globals = new Set(options?.globals ?? DEFAULT_GLOBALS);

    return {
      BinaryExpression(node: TSESTree.BinaryExpression) {
        if (!EQUALITY_OPERATORS.has(node.operator)) return;

        let global: string | null = null;

        if (isUndefinedString(node.right)) {
          global = getTypeofGlobalName(node.left, globals);
        } else if (isUndefinedString(node.left)) {
          global = getTypeofGlobalName(node.right, globals);
        }

        if (!global) return;

        const matchesSsr = MATCHES_SSR[node.operator as EqualityOperator];
        const replacement = matchesSsr ? 'import.meta.env.SSR' : '!import.meta.env.SSR';

        context.report({
          node,
          messageId: 'preferSsrGuard',
          data: { global, replacement },
          fix: (fixer) => fixer.replaceText(node, replacement),
        });
      },
    };
  },
});
