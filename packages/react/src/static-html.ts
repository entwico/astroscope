import { createElement as h, memo } from 'react';

/**
 * Astro passes `children` as a string of html, so a wrapper element renders that
 * content as vnodes. The memo comparator always reports equal props, telling
 * react the subtree is static.
 */
export const StaticHtml = memo(
  ({ value, name, hydrate = true }: { value: string | null; name?: string; hydrate?: boolean }) => {
    // value can be a SlotString object, so emptiness is checked via trim()
    if (value == null || value.trim() === '') return null;

    const tagName = hydrate ? 'astro-slot' : 'astro-static-slot';

    return h(tagName, { name, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: value } });
  },
  () => true,
);
