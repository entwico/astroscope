import React, { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RenderOptions } from './render.js';

const { record, add, logError } = vi.hoisted(() => ({ record: vi.fn(), add: vi.fn(), logError: vi.fn() }));

vi.mock('@astroscope/node/telemetry', () => ({
  DURATION_BUCKETS: { compute: [], io: [], http: [] },
  createHistogram: () => ({ record }),
  createCounter: () => ({ add }),
  errorType: (error: unknown) => (error instanceof Error ? error.constructor.name : typeof error),
}));

vi.mock('@astroscope/node/log', () => ({ log: { error: logError } }));

vi.mock('astro:react:opts', () => ({ default: {} }));

const { renderIsland } = await import('./render.js');
const { componentName } = await import('./telemetry.js');
const { default: renderer } = await import('./server.js');

const options: RenderOptions = { identifierPrefix: 'r0' };

function Plain({ label }: { label: string }) {
  return React.createElement('p', null, label);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('componentName', () => {
  test('prefers displayName, then the function name, through memo wrappers', () => {
    const Named = () => null;

    Named.displayName = 'Fancy';

    expect(componentName(Plain)).toBe('Plain');
    expect(componentName(Named)).toBe('Fancy');
    expect(componentName(React.memo(Plain))).toBe('Plain');
    expect(
      componentName(
        React.forwardRef(function Inner() {
          return null;
        }),
      ),
    ).toBe('Inner');
    expect(componentName(() => null)).toBe('anonymous');
    expect(componentName(undefined)).toBe('anonymous');
  });
});

describe('render failures', () => {
  test('a throw on the synchronous path counts as a root failure', () => {
    const Broken = () => {
      throw new TypeError('boom');
    };

    expect(() => renderIsland(Broken, React.createElement(Broken), options)).toThrow('boom');

    expect(add).toHaveBeenCalledWith(1, {
      'astro.island.component': 'Broken',
      'astro.island.error.kind': 'root',
      'error.type': 'TypeError',
    });
  });

  test('a boundary failing on the streaming path counts, logs and leaves the fallback', async () => {
    const Inner = () => {
      throw new Error('inside');
    };
    const Bounded = () => React.createElement(Suspense, { fallback: 'fallback' }, React.createElement(Inner));

    const html = await renderIsland(Bounded, React.createElement(Bounded), options, {
      componentUrl: '/src/Bounded.tsx',
    } as never);

    expect(html).toContain('fallback');
    expect(add).toHaveBeenCalledWith(1, {
      'astro.island.component': 'Bounded',
      'astro.island.error.kind': 'boundary',
      'error.type': 'Error',
    });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'Bounded', componentUrl: '/src/Bounded.tsx' }),
      'react island boundary failed during server render, left to the client',
    );
  });

  test('the shell failing on the streaming path counts as a root failure', async () => {
    const Broken = () => {
      throw new RangeError('shell');
    };

    await expect(
      renderIsland(Broken, React.createElement(Broken), {
        ...options,
        formState: [null, 'key', '/_actions/x'] as unknown as NonNullable<RenderOptions['formState']>,
      }),
    ).rejects.toThrow('shell');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, {
      'astro.island.component': 'Broken',
      'astro.island.error.kind': 'root',
      'error.type': 'RangeError',
    });
  });
});

describe('render duration', () => {
  const context = () => ({ result: { request: new Request('http://localhost/'), actionResult: undefined } });

  test('records the island name and the path taken', async () => {
    const rendered = await renderer.renderToStaticMarkup.call(context() as never, Plain, { label: 'hi' }, {});

    expect(rendered.html).toBe('<p>hi</p>');
    expect(record).toHaveBeenCalledWith(expect.any(Number), {
      'astro.island.component': 'Plain',
      'astro.island.render.path': 'string',
    });
  });

  test('the detection probe is timed per component', async () => {
    expect(await renderer.check.call(context() as never, Plain, { label: 'hi' }, {})).toBe(true);

    expect(record).toHaveBeenCalledWith(expect.any(Number), { 'astro.island.component': 'Plain' });
  });
});
