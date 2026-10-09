import type { Rule } from 'eslint';
import type { ImportDeclaration, ImportSpecifier } from 'estree';

const DEFAULT_SOURCE = '@astroscope/node/guards';

type Options = [{ source?: string | undefined }?];

/**
 * `defineAction` from `astro:actions` has no place for guards, so an action defined with it is
 * unguarded by construction and nothing in the type system says so. The platform's
 * `defineAction` takes `guards` and narrows `locals` for the handler; every action goes through
 * it, guarded or not, so the only difference between the two is whether protection is possible.
 * The other `astro:actions` exports (`ActionError`, `getActionContext`, `actions`) stay legal.
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

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'astro:actions') return;

        const specifier = node.specifiers.find(
          (candidate): candidate is ImportSpecifier =>
            candidate.type === 'ImportSpecifier' &&
            candidate.imported.type === 'Identifier' &&
            candidate.imported.name === 'defineAction',
        );

        if (!specifier) return;

        context.report({
          node: specifier,
          messageId: 'astroDefineAction',
          data: { source },
          fix: (fixer) => fix(fixer, node, specifier, source, context.sourceCode),
        });
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
  const quote = sourceCode.getText(declaration.source).startsWith('"') ? '"' : "'";
  const replacement = `import { ${sourceCode.getText(specifier)} } from ${quote}${source}${quote};`;

  if (declaration.specifiers.length === 1) {
    return fixer.replaceText(declaration, replacement);
  }

  const others = declaration.specifiers.filter((candidate) => candidate !== specifier);

  // a mixed import keeps the other specifiers; a default or namespace specifier cannot sit in
  // the braces, and it never appears together with named ones on `astro:actions`
  if (others.some((candidate) => candidate.type !== 'ImportSpecifier')) {
    return null;
  }

  const kept = `import { ${others.map((candidate) => sourceCode.getText(candidate)).join(', ')} } from ${quote}astro:actions${quote};`;

  return fixer.replaceText(declaration, `${replacement}\n${kept}`);
}
