import upstream from '@astrojs/react/server.js';
import { type MaybePromise, maybeThen } from '@entwico/dash';
import type { AstroComponentMetadata, NamedSSRLoadedRendererValue, SSRResult } from 'astro';
import React from 'react';
import { type RenderOptions, renderIsland } from './render.js';
import { StaticHtml } from './static-html.js';
import { checkDuration, componentName, renderDuration } from './telemetry.js';

/**
 * Server renderer for React islands. `check` is upstream's own; slots, the
 * useId prefix and Actions form state are copied from `@astrojs/react`'s
 * `server.ts` (not exported there — diff against upstream when the pin moves).
 * The rendering itself is in `render.ts`: synchronous `renderToString` with a
 * per-component streaming fallback. `experimentalReactChildren` is not supported.
 */

type RendererContext = { result: SSRResult };

const slotName = (str: string) => str.trim().replace(/[-_]([a-z])/g, (_, w: string) => w.toUpperCase());

function needsHydration(metadata?: AstroComponentMetadata) {
  // adjust how this is hydrated only when the version of astro supports `astroStaticSlot`
  return metadata?.astroStaticSlot ? !!metadata.hydrate : true;
}

// synchronous end to end unless the island streams or carries form state — astro
// awaits the result either way, so the promise per island is spared
function renderToStaticMarkup(
  this: RendererContext,
  Component: any,
  props: Record<string, any>,
  { default: children, ...slotted }: Record<string, any>,
  metadata?: AstroComponentMetadata,
) {
  const started = performance.now();
  const prefix = this?.result ? incrementId(this.result) : undefined;
  const attrs: Record<string, any> = { prefix };

  delete props['class'];

  const slots: Record<string, any> = {};

  for (const [key, value] of Object.entries(slotted)) {
    const name = slotName(key);

    slots[name] = React.createElement(StaticHtml, { hydrate: needsHydration(metadata), value, name });
  }

  // create newProps to avoid mutating `props` before they are serialized
  const newProps = { ...props, ...slots };
  const newChildren = children ?? props['children'];

  if (newChildren != null) {
    newProps['children'] = React.createElement(StaticHtml, { hydrate: needsHydration(metadata), value: newChildren });
  }

  return maybeThen(this ? getFormState(this) : undefined, (formState) => {
    if (formState) {
      attrs['data-action-result'] = JSON.stringify(formState[0]);
      attrs['data-action-key'] = formState[1];
      attrs['data-action-name'] = formState[2];
    }

    const vnode = React.createElement(Component, newProps);
    const renderOptions: RenderOptions = {
      ...(prefix !== undefined && { identifierPrefix: prefix }),
      // react types the form state as an opaque brand; the tuple is what it reads at runtime
      ...(formState && { formState: formState as unknown as NonNullable<RenderOptions['formState']> }),
    };

    const rendered = renderIsland(Component, vnode, renderOptions, metadata);

    return maybeThen(rendered, (html) => {
      renderDuration.record((performance.now() - started) / 1000, {
        'astro.island.component': componentName(Component),
        'astro.island.render.path': typeof rendered === 'string' ? 'string' : 'stream',
      });

      return {
        // strip react 19 auto-injected resource hints (preloads, etc.) from island
        // output — these belong in <head>, not inside the island
        // see https://github.com/facebook/react/issues/27910
        html: html.replace(/<link\s[^>]*rel="(?:preload|modulepreload|stylesheet|preconnect|dns-prefetch)"[^>]*>/g, ''),
        attrs,
      };
    });
  });
}

const check: NamedSSRLoadedRendererValue['check'] = async function (this: RendererContext, Component, ...rest) {
  const started = performance.now();
  const result = await upstream.check.call(this, Component, ...rest);

  checkDuration.record((performance.now() - started) / 1000, { 'astro.island.component': componentName(Component) });

  return result;
};

const ID_PREFIX = 'r';

const contexts = new WeakMap<SSRResult, { currentIndex: number }>();

function incrementId(result: SSRResult): string {
  let ctx = contexts.get(result);

  if (!ctx) {
    ctx = { currentIndex: 0 };
    contexts.set(result, ctx);
  }

  return `${ID_PREFIX}${ctx.currentIndex++}`;
}

const formContentTypes = ['application/x-www-form-urlencoded', 'multipart/form-data'];

function isFormRequest(contentType: string | null) {
  // split off parameters like charset or boundary
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type#content-type_in_html_forms
  const type = contentType?.split(';')[0]?.toLowerCase();

  return formContentTypes.some((t) => type === t);
}

type FormState = [actionResult: any, actionKey: string, actionName: string];

function getFormState({ result }: RendererContext): MaybePromise<FormState | undefined> {
  const { request, actionResult } = result;

  if (!actionResult) return undefined;
  if (!isFormRequest(request.headers.get('content-type'))) return undefined;

  const { searchParams } = new URL(request.url);

  return request
    .clone()
    .formData()
    .then((formData) => {
      // the key generated by react to identify each `useActionState()` call, e.g. "k511f74df5a35d32e7cf266450d85cb6c"
      const actionKey = formData.get('$ACTION_KEY')?.toString();
      // the action name returned by an action's `toString()`, matching the endpoint path, e.g. "/_actions/blog.like"
      const actionName = searchParams.get('_action');

      if (!actionKey || !actionName) return undefined;

      return [actionResult, actionKey, actionName];
    });
}

const renderer: NamedSSRLoadedRendererValue = {
  name: '@astrojs/react',
  check,
  // astro awaits the result, so a synchronous return is fine at runtime; the type asks for a promise
  renderToStaticMarkup: renderToStaticMarkup as unknown as NamedSSRLoadedRendererValue['renderToStaticMarkup'],
  supportsAstroStaticSlot: true,
};

export default renderer;
