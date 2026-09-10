import React, { Suspense, lazy } from 'react';
import type * as ReactDOMServer from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RenderOptions } from './render.js';

const { logError, renderToString, renderToReadableStream } = vi.hoisted(() => ({
  logError: vi.fn(),
  renderToString: vi.fn(),
  renderToReadableStream: vi.fn(),
}));

vi.mock('@astroscope/node/log', () => ({ log: { error: logError } }));

vi.mock('react-dom/server', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOMServer>();

  renderToString.mockImplementation(actual.renderToString);
  renderToReadableStream.mockImplementation(actual.renderToReadableStream);

  return { default: { ...actual, renderToString, renderToReadableStream } };
});

const { renderIsland } = await import('./render.js');

const options: RenderOptions = { identifierPrefix: 'r0' };

function Plain({ label }: { label: string }) {
  return React.createElement('p', null, label);
}

function createLazy() {
  return lazy(() => Promise.resolve({ default: () => React.createElement('p', null, 'lazy content') }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renderIsland', () => {
  test('renders synchronously when nothing suspends', async () => {
    const html = await renderIsland(Plain, React.createElement(Plain, { label: 'hi' }), options);

    expect(html).toBe('<p>hi</p>');
    expect(renderToString).toHaveBeenCalledTimes(1);
    expect(renderToReadableStream).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  test('falls back to streaming when a suspense boundary suspends', async () => {
    const Lazy = createLazy();
    const Boundary = () => React.createElement(Suspense, { fallback: 'loading' }, React.createElement(Lazy));

    const html = await renderIsland(Boundary, React.createElement(Boundary), options, {
      componentUrl: '/src/Boundary.tsx',
    } as never);

    expect(html).toContain('lazy content');
    expect(html).not.toContain('<!--$!-->');
    expect(renderToString).toHaveBeenCalledTimes(1);
    expect(renderToReadableStream).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toEqual({ componentUrl: '/src/Boundary.tsx' });
  });

  test('falls back to streaming when the root suspends outside any boundary', async () => {
    const Lazy = createLazy();
    const Root = () => React.createElement(Lazy);

    const html = await renderIsland(Root, React.createElement(Root), options);

    expect(html).toContain('lazy content');
    expect(renderToString).toHaveBeenCalledTimes(1);
    expect(renderToReadableStream).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  test('skips straight to streaming for a component that suspended before', async () => {
    const Lazy = createLazy();
    const Root = () => React.createElement(Lazy);

    await renderIsland(Root, React.createElement(Root), options);
    vi.clearAllMocks();

    const html = await renderIsland(Root, React.createElement(Root), options);

    expect(html).toContain('lazy content');
    expect(renderToString).not.toHaveBeenCalled();
    expect(renderToReadableStream).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  test('rethrows render errors instead of retrying', async () => {
    const Broken = () => {
      throw new Error('boom');
    };

    // the fast path is synchronous, so the error is too
    expect(() => renderIsland(Broken, React.createElement(Broken), options)).toThrow('boom');
    expect(renderToReadableStream).not.toHaveBeenCalled();
  });

  test('uses the streaming api when actions form state is present', async () => {
    const html = await renderIsland(Plain, React.createElement(Plain, { label: 'form' }), {
      ...options,
      formState: [null, 'key', '/_actions/x'] as unknown as NonNullable<RenderOptions['formState']>,
    });

    expect(html).toContain('form');
    expect(renderToString).not.toHaveBeenCalled();
    expect(renderToReadableStream).toHaveBeenCalledTimes(1);
  });
});
