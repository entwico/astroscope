import { log } from '@astroscope/node/log';
import type { MaybePromise } from '@entwico/dash';
import type { AstroComponentMetadata } from 'astro';
import type { ReactNode } from 'react';
import ReactDOM, { type RenderToReadableStreamOptions } from 'react-dom/server';
import { componentName, recordRenderFailure } from './telemetry.js';

export interface RenderOptions {
  identifierPrefix?: string;
  formState?: Exclude<RenderToReadableStreamOptions['formState'], undefined>;
}

// react-dom's legacy renderer emits a suspended boundary as its fallback with
// this marker (client-rendered boundary) instead of waiting for the content
const SUSPENDED_BOUNDARY_MARKER = '<!--$!-->';
// and throws this when something suspends outside any boundary
const ROOT_SUSPENDED_MESSAGE = 'A component suspended while responding to synchronous input';

// components observed suspending on the server render through the streaming
// api from then on; process-lifetime, keyed by the component reference
const streamed = new WeakSet<WeakKey>();

/**
 * Renders an island to html. `renderToString` is about 3x cheaper than
 * streaming into a string and is used whenever the component does not suspend
 * on the server; when it does (a suspended boundary in the output, or a root
 * suspension error), the island is re-rendered with `renderToReadableStream`,
 * which waits for the suspended content, and the component is remembered so
 * later renders skip straight to the streaming api. Actions form state only
 * exists on the streaming api, so form submissions always take that path.
 */
export function renderIsland(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): MaybePromise<string> {
  if (!options.formState && !streamed.has(Component)) {
    try {
      const html = ReactDOM.renderToString(vnode, options);

      if (!html.includes(SUSPENDED_BOUNDARY_MARKER)) {
        return html;
      }
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith(ROOT_SUSPENDED_MESSAGE))) {
        recordRenderFailure(Component, 'root', error);

        throw error;
      }
    }

    streamed.add(Component);

    log.error(
      { componentUrl: metadata?.componentUrl },
      'react island suspended during server render, streaming this component from now on',
    );
  }

  return renderStream(Component, vnode, options, metadata);
}

// a boundary failing inside the stream is left to the client (react emits the
// fallback with the client-render marker); the shell failing rejects the render
function renderStream(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): Promise<string> {
  const errors: unknown[] = [];

  return ReactDOM.renderToReadableStream(vnode, {
    ...options,
    onError: (error) => {
      errors.push(error);

      return undefined;
    },
  })
    .then(readToString)
    .then(
      (html) => {
        for (const error of errors) {
          recordRenderFailure(Component, 'boundary', error);
          log.error(
            { err: error, component: componentName(Component), componentUrl: metadata?.componentUrl },
            'react island boundary failed during server render, left to the client',
          );
        }

        return html;
      },
      (error: unknown) => {
        recordRenderFailure(Component, 'root', error);

        throw error;
      },
    );
}

async function readToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let result = '';

  for await (const chunk of stream) {
    result += decoder.decode(chunk, { stream: true });
  }

  return result + decoder.decode();
}
