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

// react-dom's legacy renderer emits a boundary it did not finish — suspended, or
// failed — as its fallback behind this client-render marker, always followed by
// a template element; the comment alone could come from injected html
const SUSPENDED_BOUNDARY_MARKER = '<!--$!--><template';
// and throws this when something suspends outside any boundary
const ROOT_SUSPENDED_MESSAGE = 'A component suspended while responding to synchronous input';

// components observed suspending on the server render through the streaming
// api from then on; process-lifetime, keyed by the component reference
const streamed = new WeakSet<WeakKey>();

/**
 * Renders an island to html. `renderToString` is about 3x cheaper than
 * streaming into a string and is used whenever the component does not suspend
 * on the server; when it does (an unfinished boundary in the output, or a root
 * suspension error), the island is re-rendered with `renderToReadableStream`,
 * which waits for the suspended content, and the component is remembered so
 * later renders skip straight to the streaming api. An unfinished boundary is
 * also what a boundary that threw looks like, and the string renderer reports
 * no errors, so the streaming render tells the two apart: a boundary error
 * there means the component did not suspend and is not remembered. Actions
 * form state only exists on the streaming api, so form submissions always take
 * that path.
 */
export function renderIsland(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): MaybePromise<string> {
  if (options.formState || streamed.has(Component)) {
    return renderStream(Component, vnode, options, metadata);
  }

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

    streamFromNowOn(Component, metadata);

    return renderStream(Component, vnode, options, metadata);
  }

  return classifyUnfinishedBoundary(Component, vnode, options, metadata);
}

async function classifyUnfinishedBoundary(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): Promise<string> {
  const { html, boundaryErrors } = await renderStreamReporting(Component, vnode, options, metadata);

  if (boundaryErrors === 0) {
    streamFromNowOn(Component, metadata);
  }

  return html;
}

function streamFromNowOn(Component: WeakKey, metadata?: AstroComponentMetadata): void {
  streamed.add(Component);

  log.error(
    { componentUrl: metadata?.componentUrl },
    'react island suspended during server render, streaming this component from now on',
  );
}

async function renderStream(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): Promise<string> {
  const { html } = await renderStreamReporting(Component, vnode, options, metadata);

  return html;
}

// a boundary failing inside the stream is left to the client (react emits the
// fallback with the client-render marker); the shell failing rejects the render
async function renderStreamReporting(
  Component: WeakKey,
  vnode: ReactNode,
  options: RenderOptions,
  metadata?: AstroComponentMetadata,
): Promise<{ html: string; boundaryErrors: number }> {
  const errors: unknown[] = [];
  let html: string;

  try {
    const stream = await ReactDOM.renderToReadableStream(vnode, {
      ...options,
      onError: (error) => {
        errors.push(error);

        return;
      },
    });

    html = await readToString(stream);
  } catch (error) {
    recordRenderFailure(Component, 'root', error);

    throw error;
  }

  for (const error of errors) {
    recordRenderFailure(Component, 'boundary', error);
    log.error(
      { err: error, component: componentName(Component), componentUrl: metadata?.componentUrl },
      'react island boundary failed during server render, left to the client',
    );
  }

  return { html, boundaryErrors: errors.length };
}

async function readToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let result = '';

  for await (const chunk of stream) {
    result += decoder.decode(chunk, { stream: true });
  }

  return result + decoder.decode();
}
