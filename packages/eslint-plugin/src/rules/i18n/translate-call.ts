import type { Expression, Super } from 'estree';

/** whether a call's callee is one of the translation functions the extractor reads: `t` or `rich` */
export function isTranslateCall(callee: Expression | Super): boolean {
  return callee.type === 'Identifier' && (callee.name === 't' || callee.name === 'rich');
}
