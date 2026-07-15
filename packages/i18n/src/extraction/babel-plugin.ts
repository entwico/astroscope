import type { NodePath, PluginObject, PluginPass } from '@babel/core';
import type * as BabelTypes from '@babel/types';
import type { Expression, Node, ObjectExpression } from '@babel/types';
import type { TranslationMeta, VariableDef } from '../shared/types.js';
import type { ExtractedKeyOccurrence, ExtractionError } from './types.js';

export type I18nExtractPluginOpts = {
  onKeyExtracted: (key: ExtractedKeyOccurrence) => void;
  onExtractionError: (error: ExtractionError) => void;
  stripFallbacks: boolean;
};

type PluginState = PluginPass & { opts: I18nExtractPluginOpts };

type ReportFn = (reason: string) => void;

/**
 * Extract string value from AST node
 */
function getStringValue(t: typeof BabelTypes, node: Node): string | null {
  if (t.isStringLiteral(node)) {
    return node.value;
  }

  if (t.isTemplateLiteral(node) && node.quasis.length === 1 && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }

  return null;
}

/**
 * Extract TranslationMeta from the second argument of t()
 */
function extractMeta(t: typeof BabelTypes, node: Expression, report: ReportFn): TranslationMeta {
  // string shorthand: t('key', 'fallback')
  const stringValue = getStringValue(t, node);

  if (stringValue !== null) {
    return { fallback: stringValue };
  }

  // dynamic template literal: t('key', `Hello ${name}`)
  if (t.isTemplateLiteral(node) && node.expressions.length > 0) {
    report('the fallback is a template literal with expressions');

    return { fallback: '' };
  }

  // object form: t('key', { fallback: '...', description: '...', variables: {...} })
  if (t.isObjectExpression(node)) {
    const meta: TranslationMeta = { fallback: '' };

    for (const prop of node.properties) {
      // spread elements cannot be extracted statically
      if (t.isSpreadElement(prop)) {
        report('the meta object contains a spread element');

        continue;
      }

      if (!t.isObjectProperty(prop)) continue;
      if (!t.isIdentifier(prop.key)) continue;

      const name = prop.key.name;

      if (name === 'fallback') {
        const value = getStringValue(t, prop.value as Node);

        if (value !== null) {
          meta.fallback = value;
        } else {
          report('the fallback is not a static string');
        }
      } else if (name === 'description') {
        const value = getStringValue(t, prop.value as Node);

        if (value !== null) {
          meta.description = value;
        } else {
          report('the description is not a static string');
        }
      } else if (name === 'variables' && t.isObjectExpression(prop.value)) {
        meta.variables = extractVariables(t, prop.value, report);
      }
    }

    return meta;
  }

  // dynamic meta (e.g. variable reference)
  report('the meta is neither a static string nor an object literal');

  return { fallback: '' };
}

/**
 * Extract variables definition from object expression
 */
function extractVariables(
  t: typeof BabelTypes,
  obj: ObjectExpression,
  report: ReportFn,
): Record<string, VariableDef> | undefined {
  const result: Record<string, VariableDef> = {};

  for (const prop of obj.properties) {
    if (t.isSpreadElement(prop)) {
      report('the variables object contains a spread element');
      continue;
    }

    if (!t.isObjectProperty(prop)) continue;
    if (!t.isIdentifier(prop.key)) continue;

    const varName = prop.key.name;

    if (t.isObjectExpression(prop.value)) {
      const varDef: VariableDef = {};

      for (const varProp of prop.value.properties) {
        if (t.isSpreadElement(varProp)) {
          report(`variable "${varName}" contains a spread element`);
          continue;
        }

        if (!t.isObjectProperty(varProp)) continue;
        if (!t.isIdentifier(varProp.key)) continue;

        const varPropName = varProp.key.name;
        const value = getStringValue(t, varProp.value as Node);

        if (value !== null) {
          if (varPropName === 'fallback') {
            varDef.fallback = value;
          } else if (varPropName === 'description') {
            varDef.description = value;
          }
        } else if (varPropName === 'fallback' || varPropName === 'description') {
          report(`variable "${varName}.${varPropName}" is not a static string`);
        }
      }

      result[varName] = varDef;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Babel plugin for i18n extraction and transformation
 *
 * - Extracts t() calls with key and metadata
 * - Strips fallback argument in production builds
 */
export function i18nExtractPlugin({ types: t }: { types: typeof BabelTypes }): PluginObject<PluginState> {
  return {
    name: '@astroscope/i18n/extract',
    visitor: {
      CallExpression(path: NodePath<BabelTypes.CallExpression>, state: PluginState) {
        // check if callee is 't' identifier
        // we assume that it was not aliased / reassigned
        if (!path.get('callee').isIdentifier({ name: 't' })) return;

        const args = path.node.arguments;
        const keyArg = args[0];

        // check first arg
        if (!t.isExpression(keyArg)) return;

        const key = getStringValue(t, keyArg);

        if (key === null) return; // first arg must be string
        // end check first arg

        const file = state.filename ?? '';
        const line = path.node.loc?.start.line ?? 0;
        const column = path.node.loc?.start.column ?? 0;
        const report: ReportFn = (reason) => state.opts.onExtractionError({ key, reason, file, line, column });

        // second arg is always meta (fallback string or object)
        // may not exist if we're processing already-transformed code
        const meta = args.length >= 2 && t.isExpression(args[1]) ? extractMeta(t, args[1], report) : { fallback: '' };

        // report extracted key
        state.opts.onKeyExtracted({ key, meta, file, line });

        // strip fallback in production
        // t('key', 'fallback') → t('key')
        // t('key', 'fallback', values) → t('key', undefined, values)
        if (state.opts.stripFallbacks && args.length >= 2) {
          const firstArg = args[0]!;

          if (args.length === 2) {
            path.node.arguments = [firstArg];
          } else {
            path.node.arguments = [firstArg, t.identifier('undefined'), args[2]!];
          }
        }
      },
    },
  };
}
