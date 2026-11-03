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

        if (value === null) {
          report('the fallback is not a static string');
        } else {
          meta.fallback = value;
        }
      } else if (name === 'description') {
        const value = getStringValue(t, prop.value as Node);

        if (value === null) {
          report('the description is not a static string');
        } else {
          meta.description = value;
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

    if (!t.isObjectExpression(prop.value)) continue;

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

  return Object.keys(result).length > 0 ? result : undefined;
}

const TRANSLATE_MODULE = '@astroscope/i18n/translate';

type TranslateCall = BabelTypes.CallExpression | BabelTypes.OptionalCallExpression;

/**
 * Whether a call's callee is `t` or `rich` imported from the translate module
 * under its own name. Aliases are out of scope (`no-t-reassign` lints them); a
 * local binding that merely shares the name is not a translation call.
 */
function isTranslateCall(path: NodePath<TranslateCall>): boolean {
  const callee = path.get('callee');

  if (!callee.isIdentifier({ name: 't' }) && !callee.isIdentifier({ name: 'rich' })) return false;

  const binding = path.scope.getBinding(callee.node.name);
  const specifier = binding?.path;

  if (!specifier?.isImportSpecifier() || !specifier.parentPath.isImportDeclaration()) return false;

  const imported = specifier.node.imported;
  const importedName = imported.type === 'Identifier' ? imported.name : imported.value;

  return importedName === callee.node.name && specifier.parentPath.node.source.value === TRANSLATE_MODULE;
}

/**
 * Babel plugin for i18n extraction and transformation
 *
 * - Extracts t() and rich() calls with key and metadata
 * - Strips fallback argument in production builds
 */
export function i18nExtractPlugin({ types: t }: { types: typeof BabelTypes }): PluginObject<PluginState> {
  const visitCall = (path: NodePath<TranslateCall>, state: PluginState): void => {
    if (!isTranslateCall(path)) return;

    const args = path.node.arguments;
    const keyArg = args[0];

    if (!t.isExpression(keyArg)) return;

    const key = getStringValue(t, keyArg);

    if (key === null) return; // first arg must be string

    const file = state.filename ?? '';
    const line = path.node.loc?.start.line ?? 0;
    const column = path.node.loc?.start.column ?? 0;
    const report: ReportFn = (reason) => state.opts.onExtractionError({ key, reason, file, line, column });

    // second arg is always meta (fallback string or object)
    // may not exist if we're processing already-transformed code
    const meta = args.length >= 2 && t.isExpression(args[1]) ? extractMeta(t, args[1], report) : { fallback: '' };

    state.opts.onKeyExtracted({ key, meta, file, line });

    // strip fallback in production
    // t('key', 'fallback') → t('key')
    // t('key', 'fallback', values) → t('key', undefined, values)
    // rich('key', 'fallback', components, values) → rich('key', undefined, components, values)
    if (!state.opts.stripFallbacks || args.length < 2) return;

    const firstArg = args[0]!;

    if (args.length === 2) {
      path.node.arguments = [firstArg];
    } else {
      path.node.arguments = [firstArg, t.identifier('undefined'), ...args.slice(2)];
    }
  };

  return {
    name: '@astroscope/i18n/extract',
    visitor: {
      CallExpression: visitCall,
      OptionalCallExpression: visitCall,
    },
  };
}
