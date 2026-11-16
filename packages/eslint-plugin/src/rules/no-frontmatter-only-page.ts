import type { Rule } from 'eslint';
import type { Node } from 'estree';

type TemplateNode = {
  type: string;
  value?: string | undefined;
  expression?: { type: string } | undefined;
  children?: TemplateNode[] | undefined;
};

const PAGES_DIR = /[/\\]pages[/\\]/;

// whitespace and comments render nothing a visitor would see
function rendersNothing(node: TemplateNode): boolean {
  if (node.type === 'JSXText') return (node.value ?? '').trim() === '';
  if (node.type === 'AstroHTMLComment') return true;

  return node.type === 'JSXExpressionContainer' && node.expression?.type === 'JSXEmptyExpression';
}

function isTemplate(node: Node | TemplateNode): node is TemplateNode {
  return (node.type as string) === 'AstroFragment';
}

export const noFrontmatterOnlyPage: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow `.astro` pages that consist of frontmatter only — a page that renders nothing is an endpoint',
    },
    messages: {
      frontmatterOnly:
        'this page has frontmatter but no template: it only redirects or responds. Write it as a `.ts` endpoint instead.',
    },
    schema: [],
  },
  create(context) {
    if (!context.filename.endsWith('.astro') || !PAGES_DIR.test(context.filename)) {
      return {};
    }

    return {
      Program(node) {
        const body: (Node | TemplateNode)[] = node.body;
        const hasFrontmatter = body.some((statement) => !isTemplate(statement));
        const hasTemplate = body.some(
          (statement) => isTemplate(statement) && (statement.children ?? []).some((child) => !rendersNothing(child)),
        );

        if (hasFrontmatter && !hasTemplate) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'frontmatterOnly' });
        }
      },
    };
  },
};
