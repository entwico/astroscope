import type { ConsentAnswer, ConsentSource, DestinationName } from '../shared.js';

type Ccm19 = {
  /** the accepted cookie name patterns, e.g. `_ga_*`; empty before a choice */
  acceptedCookies?: readonly string[] | undefined;
  /** the accepted embeddings; empty before a choice */
  acceptedEmbeddings?: readonly { id: string; name: string }[] | undefined;
};

declare global {
  interface Window {
    /** what ccm19 exposes once its script has run */
    CCM?: Ccm19 | undefined;
  }
}

/**
 * How a destination's consent is read from ccm19: the embedding with this id is accepted (a missing id
 * never is), an accepted cookie pattern matches, an answer of your own, or `false` for a destination
 * that needs none.
 */
export type Ccm19Rule =
  | (() => ConsentAnswer)
  | false
  | { embedding: string | undefined }
  | { cookie: (pattern: string) => boolean };

const ccm = (): Ccm19 | undefined => globalThis.window.CCM;

function answer(rule: Ccm19Rule): ConsentAnswer {
  if (rule === false) return true;
  if (typeof rule === 'function') return rule();

  const current = ccm();

  if ('embedding' in rule) {
    const embeddings = current?.acceptedEmbeddings;

    if (!embeddings) return undefined;

    return rule.embedding !== undefined && embeddings.some((embedding) => embedding.id === rule.embedding);
  }

  return current?.acceptedCookies?.some((pattern) => rule.cookie(pattern));
}

/**
 * The consent source over ccm19: a rule per destination, `undefined` until ccm19 has run, re-checked
 * when the visitor closes the widget.
 */
export function ccm19<N extends DestinationName>(rules: { [K in N]: Ccm19Rule }): ConsentSource<N> {
  const entries = Object.entries(rules) as [N, Ccm19Rule][];

  return {
    names: entries.map(([name]) => name),
    free: entries.filter(([, rule]) => rule === false).map(([name]) => name),
    of: (name) => answer(rules[name]),
    watch: (notify) => globalThis.window.addEventListener('ccm19WidgetClosed', notify),
  };
}
