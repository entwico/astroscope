import React from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@astroscope/node/telemetry', () => ({
  DURATION_BUCKETS: { compute: [], io: [], http: [] },
  createHistogram: () => ({ record: vi.fn() }),
  createCounter: () => ({ add: vi.fn() }),
  errorType: (error: unknown) => (error instanceof Error ? error.constructor.name : typeof error),
}));

vi.mock('@astroscope/node/log', () => ({ log: { error: vi.fn() } }));

vi.mock('astro:react:opts', () => ({ default: {} }));

const { default: renderer } = await import('./server.js');

function Wrapper({ children }: { children?: React.ReactNode }) {
  return React.createElement('div', null, children);
}

function Stylesheet() {
  return React.createElement('link', { rel: 'stylesheet', href: '/island.css' });
}

function Hoisting() {
  return React.createElement(
    'div',
    null,
    React.createElement('link', { rel: 'preload', href: '/hero.avif', as: 'image' }),
    React.createElement('link', { rel: 'stylesheet', href: '/theme.css', precedence: 'high' }),
    React.createElement('link', { rel: 'stylesheet', href: '/island.css' }),
  );
}

describe('renderToStaticMarkup', () => {
  test('drops the resources react hoists ahead of the island markup', async () => {
    const rendered = await renderer.renderToStaticMarkup.call(undefined as never, Hoisting, {}, {});

    expect(rendered.html).toBe('<div><link rel="stylesheet" href="/island.css"/></div>');
  });

  test('keeps a link the component renders in place', async () => {
    const rendered = await renderer.renderToStaticMarkup.call(undefined as never, Stylesheet, {}, {});

    expect(rendered.html).toContain('<link rel="stylesheet" href="/island.css"/>');
  });

  test('passes slot html through unchanged', async () => {
    const slot = '<link rel="preload" href="/hero.avif" as="image"><p>slot</p>';
    const rendered = await renderer.renderToStaticMarkup.call(undefined as never, Wrapper, {}, { default: slot });

    expect(rendered.html).toContain(slot);
  });

  test('reads the form body once per request, whatever the island count', async () => {
    const request = new Request('http://localhost/?_action=/_actions/like', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '$ACTION_KEY=k1',
    });
    const clone = vi.spyOn(request, 'clone');
    const context = { result: { request, actionResult: { data: 1 } } };

    for (let i = 0; i < 3; i++) {
      const rendered = await renderer.renderToStaticMarkup.call(context as never, Wrapper, {}, {});

      expect(rendered.attrs?.['data-action-key']).toBe('k1');
    }

    expect(clone).toHaveBeenCalledTimes(1);
  });
});
