import type { Rule } from 'eslint';

const DEFAULT_IGNORE_PATTERNS = [
  /^\s*$/, // whitespace only
  /^\s*[{}]\s*/, // just braces
  /^[0-9.]+$/, // numbers
  /^\s*\|\s*$/, // pipe separators
  /^\s*[•·–—]\s*$/, // bullets / dashes
  /^[\s\p{P}\p{S}]+$/u, // punctuation / symbols only (e.g. "(", ",", "/ —")
  /^#[0-9a-fA-F]{3,8}$/, // hex colors (e.g. "#003366", "#fff")
  /^\d+x\d+$/, // dimensions (e.g. "180x180")
];

export const DEFAULT_IGNORE_ATTRIBUTES = [
  // html attributes
  'id',
  'class',
  'className',
  'style',
  'href',
  'src',
  'type',
  'name',
  'value',
  'role',
  'htmlFor',
  'target',
  'rel',
  'method',
  'action',
  'loading',
  'decoding',
  'autoComplete',
  'inputMode',
  'allow',
  'as',
  'sizes',
  'color',
  'crossorigin',
  'fetchPriority',
  'fetchpriority',
  'referrerpolicy',
  'charset',
  'lang',
  'srcLang',
  'property',
  'itemprop',
  'itemtype',
  'form',
  'key',
  'slot',

  // inline style props
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'textAlign',
  'textDecoration',
  'textTransform',
  'whiteSpace',
  'overflow',
  'display',
  'position',
  'cursor',
  'pointerEvents',
  'objectFit',
  'objectPosition',

  // common component props
  'appearance',
  'variant',
  'size',
  'mode',
  'orientation',
  'align',
  'icon',
  'tag',
  'tagName',

  // html aria attributes (non-text)
  'aria-hidden',
  'aria-live',
  'aria-atomic',
  'aria-current',
  'aria-disabled',
  'aria-expanded',
  'aria-labelledby',

  // astro attributes
  'class:list',

  // testing attributes
  'data-testid',
  'data-cy',

  // svg attributes
  'd',
  'viewBox',
  'xmlns',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'clipPath',
  'transform',
  'points',
  'pathLength',
  'filter',
  'filterUnits',
  'colorInterpolationFilters',
  'floodOpacity',
  'in',
  'in2',
  'result',
  'stroke-linecap',
  'stroke-linejoin',
  'clip-rule',
  'fill-rule',
  'fillRule',
  'clipRule',
  'mask',
  'path',
  'values',
  'operator',
  'mode',
  'stdDeviation',
  'dy',
  'dx',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
];

// attribute name patterns — any attribute matching these is ignored
const DEFAULT_IGNORE_ATTRIBUTE_PATTERNS = [
  /class(names?)?$/i, // *Class, *ClassName, *classNames (e.g. bodyClass, labelClassName, classNames)
  /^data-/, // data-* attributes
  /^on[a-zA-Z]/, // event handlers (onclick, onClick, onChange, etc.)
];

type Options = {
  ignorePatterns?: string[] | undefined;
  ignoreAttributes?: string[] | undefined;
};

export const noRawStringsInJsx: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'warn when raw strings appear in JSX that may need translation',
    },
    messages: {
      rawString: 'Raw string "{{ text }}" in JSX. Consider using `t()` for user-facing text.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ignorePatterns: {
            type: 'array',
            items: { type: 'string' },
          },
          ignoreAttributes: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options: Options = context.options[0] ?? {};

    const allPatterns = options.ignorePatterns
      ? options.ignorePatterns.map((p) => new RegExp(p))
      : DEFAULT_IGNORE_PATTERNS;

    const ignoreAttributes = new Set(options.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES);

    function shouldIgnore(text: string): boolean {
      return allPatterns.some((p) => p.test(text));
    }

    function shouldIgnoreAttribute(name: string): boolean {
      if (ignoreAttributes.has(name)) return true;

      return DEFAULT_IGNORE_ATTRIBUTE_PATTERNS.some((p) => p.test(name));
    }

    function getAttributeName(node: any): string | null {
      if (node.name?.type === 'JSXIdentifier') return node.name.name;

      if (node.name?.type === 'JSXNamespacedName') {
        return `${node.name.namespace.name}:${node.name.name.name}`;
      }

      return null;
    }

    function isInsideIgnoredAttribute(node: any): boolean {
      let current = node.parent;

      while (current) {
        if (current.type === 'JSXAttribute') {
          const attrName = getAttributeName(current);

          return attrName ? shouldIgnoreAttribute(attrName) : false;
        }

        current = current.parent;
      }

      return false;
    }

    return {
      JSXText(node: any) {
        const text: string = node.value;

        if (shouldIgnore(text)) return;

        // trim and check if there's actual content
        const trimmed = text.trim();

        if (!trimmed) return;

        context.report({
          node,
          messageId: 'rawString',
          data: { text: trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed },
        });
      },

      // string literals used as JSX attribute values: <div title="Hello" />
      JSXAttribute(node: any) {
        if (!node.value) return;
        if (node.value.type !== 'Literal' || typeof node.value.value !== 'string') return;

        const text: string = node.value.value;

        if (shouldIgnore(text)) return;
        if (isInsideIgnoredAttribute(node)) return;

        // check if this attribute name is ignored
        const attrName =
          node.name?.type === 'JSXIdentifier'
            ? node.name.name
            : node.name?.type === 'JSXNamespacedName'
              ? `${node.name.namespace.name}:${node.name.name.name}`
              : null;

        if (attrName && shouldIgnoreAttribute(attrName)) return;

        context.report({
          node: node.value,
          messageId: 'rawString',
          data: { text: text.length > 40 ? `${text.slice(0, 40)}...` : text },
        });
      },

      // string literals inside JSX expressions: <div title={value ?? 'fallback'} /> or <div>{'text'}</div>
      Literal(node: any) {
        if (typeof node.value !== 'string') return;

        const ancestors = context.sourceCode.getAncestors(node);
        const inJsxExpression = ancestors.some((a: any) => a.type === 'JSXExpressionContainer');

        if (!inJsxExpression) return;

        // skip strings inside function calls (e.g. t('key', 'fallback'))
        if (ancestors.some((a: any) => a.type === 'CallExpression')) return;

        // skip strings in comparisons (e.g. value === 'some-string')
        if (node.parent?.type === 'BinaryExpression') return;

        // skip strings in type assertions (e.g. 'some-string' as const)
        if (node.parent?.type === 'TSAsExpression') return;

        const text: string = node.value;

        if (shouldIgnore(text)) return;
        if (isInsideIgnoredAttribute(node)) return;

        context.report({
          node,
          messageId: 'rawString',
          data: { text: text.length > 40 ? `${text.slice(0, 40)}...` : text },
        });
      },
    };
  },
};
