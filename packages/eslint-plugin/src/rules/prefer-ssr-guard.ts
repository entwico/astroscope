import { ASTUtils, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

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

function getTypeofGlobal(node: TSESTree.Node, globals: ReadonlySet<string>): TSESTree.Identifier | null {
  if (node.type !== 'UnaryExpression' || node.operator !== 'typeof') return null;
  if (node.argument.type !== 'Identifier') return null;
  if (!globals.has(node.argument.name)) return null;

  return node.argument;
}

// `import.meta` is a syntax error in a commonjs module, so the fix cannot go there
function isCommonJs(filename: string, sourceType: string | undefined): boolean {
  return sourceType === 'commonjs' || /\.c[jt]s$/.test(filename);
}

export const preferSsrGuard = createRule<[{ globals?: string[] }?], 'preferSsrGuard'>({
  name: 'prefer-ssr-guard',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'prefer `import.meta.env.SSR` over `typeof window !== "undefined"` (and similar) for SSR/client guards. The Vite-injected constant tree-shakes the dead branch out of the SSR bundle, dropping client-only deps from the server build. Assumes vite-processed code: the fix is withheld in commonjs files.',
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
    const fixable = !isCommonJs(context.filename, context.languageOptions.sourceType);

    // a parameter or local named like the global is a plain value, not the browser check
    const isShadowed = (identifier: TSESTree.Identifier): boolean => {
      const variable = ASTUtils.findVariable(context.sourceCode.getScope(identifier), identifier);

      return variable !== null && variable.defs.length > 0;
    };

    return {
      BinaryExpression(node: TSESTree.BinaryExpression) {
        if (!EQUALITY_OPERATORS.has(node.operator)) return;

        let identifier: TSESTree.Identifier | null = null;

        if (isUndefinedString(node.right)) {
          identifier = getTypeofGlobal(node.left, globals);
        } else if (isUndefinedString(node.left)) {
          identifier = getTypeofGlobal(node.right, globals);
        }

        if (!identifier || isShadowed(identifier)) return;

        const matchesSsr = MATCHES_SSR[node.operator as EqualityOperator];
        const replacement = matchesSsr ? 'import.meta.env.SSR' : '!import.meta.env.SSR';

        context.report({
          node,
          messageId: 'preferSsrGuard',
          data: { global: identifier.name, replacement },
          fix: fixable ? (fixer) => fixer.replaceText(node, replacement) : null,
        });
      },
    };
  },
});
