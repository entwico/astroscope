import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/server';
import { test, vi } from 'vitest';

vi.mock('astro:react:opts', () => ({ default: {} }));
vi.mock('@astroscope/node/log', () => ({ log: { error: () => {} } }));

const upstream = (await import('@astrojs/react/server.js')).default;
const ours = (await import('./server.js')).default;

type Renderer = typeof ours;

// one SSRResult stand-in for the whole run: the renderers key their useId
// prefix counter on it, which is what a page render does across its islands
const result = { request: new Request('http://bench.local/'), actionResult: undefined };
const metadata = { componentUrl: '/_astro/Bench.js' } as never;

function render(renderer: Renderer, Component: React.ComponentType) {
  return renderer.renderToStaticMarkup.call({ result } as never, Component, {}, {}, metadata);
}

function Tree({ items }: { items: number }) {
  return React.createElement(
    'ul',
    { className: 'list' },
    Array.from({ length: items }, (_, i) =>
      React.createElement(
        'li',
        { key: i, className: i % 2 ? 'odd' : 'even' },
        React.createElement('a', { href: `/item/${i}` }, `item ${i}`),
        React.createElement('span', null, i),
      ),
    ),
  );
}

const Small = () => React.createElement(Tree, { items: 10 });
const Large = () => React.createElement(Tree, { items: 120 });

// resolved lazy: still suspends on the first server render of each request,
// which is the fallback path — upstream always streams, ours streams after
// the first observed suspension
const LazyLeaf = lazy(() => Promise.resolve({ default: () => React.createElement(Tree, { items: 10 }) }));
const Suspending = () => React.createElement(Suspense, { fallback: 'loading' }, React.createElement(LazyLeaf));

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';

  for (;;) {
    const { done, value } = await reader.read();

    if (done) return out + decoder.decode();

    out += decoder.decode(value, { stream: true });
  }
}

// the raw api pair under the two renderers, for reference
test('react-dom api, ~30 elements', async ({ bench }) => {
  await bench.compare(
    bench('renderToReadableStream + drain', async () => {
      await drain(await ReactDOM.renderToReadableStream(React.createElement(Small)));
    }),
    bench('renderToString', () => {
      ReactDOM.renderToString(React.createElement(Small));
    }),
  );
});

test('island render, ~30 elements', async ({ bench }) => {
  await bench.compare(
    bench('@astrojs/react', async () => {
      await render(upstream, Small);
    }),
    bench('@astroscope/react', async () => {
      await render(ours, Small);
    }),
  );
});

test('island render, ~360 elements', async ({ bench }) => {
  await bench.compare(
    bench('@astrojs/react', async () => {
      await render(upstream, Large);
    }),
    bench('@astroscope/react', async () => {
      await render(ours, Large);
    }),
  );
});

test('island render, suspending on the server', async ({ bench }) => {
  await bench.compare(
    bench('@astrojs/react', async () => {
      await render(upstream, Suspending);
    }),
    bench('@astroscope/react', async () => {
      await render(ours, Suspending);
    }),
  );
});
