// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineEvent, trackAttribute } from '../shared.js';
import { testConsent } from '../test-destinations.js';
import type { Destination } from './bus.js';

/** the module installs on import, so it is re-imported per test via resetModules */
async function installRelay() {
  vi.resetModules();

  const [client, { track }] = await Promise.all([import('./index.js'), import('./track.js')]);

  return { ...client, track };
}

function createDestination<N extends 'a' | 'b' = 'a'>(name: N = 'a' as N) {
  const payloads: string[] = [];
  const keys: (string | undefined)[] = [];
  const destination: Destination<N> = {
    name,
    send: (payload, meta) => {
      payloads.push(payload);
      keys.push(meta.key);
    },
  };

  return { destination, payloads, keys };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // the previous test's bus assigned the global itself, so the stub clears it
  vi.stubGlobal('__relay__', undefined);
});

describe('install', () => {
  test('drains the inline queue and takes its place', async () => {
    vi.stubGlobal('__relay__', { q: [{ a: 'early' }] });

    const { configureRelay } = await installRelay();
    const a = createDestination();

    configureRelay({ destinations: { a: a.destination }, consent: testConsent(['a']) });

    expect(a.payloads).toEqual(['early']);

    // what a later inline script does, plain or defined
    globalThis.__relay__?.q.push({ a: 'late' });
    globalThis.__relay__?.q.push({ key: 'defined', event: { a: 'later' } });

    expect(a.payloads).toEqual(['early', 'late', 'later']);
    expect(a.keys).toEqual([undefined, undefined, 'defined']);
  });

  test('a second module instance reuses the installed bus', async () => {
    const first = await installRelay();
    const second = await installRelay();
    const a = createDestination();

    first.configureRelay({ destinations: { a: a.destination }, consent: testConsent(['a']) });
    second.track({ a: 'from-second' });

    expect(a.payloads).toEqual(['from-second']);
  });
});

describe('clicks', () => {
  test('an element marked data-track tracks the event serialized into it, through its children too', async () => {
    const { configureRelay } = await installRelay();
    const a = createDestination();
    const selectOffer = defineEvent('selectOffer', (id: string) => ({ a: `select ${id}` }));

    configureRelay({ destinations: { a: a.destination }, consent: testConsent(['a']) });

    document.body.innerHTML = `<a id="offer" href="#" data-track='${trackAttribute(selectOffer('x'))}'><span id="label">buy</span></a><button id="plain">no</button><i id="broken" data-track="{nope">x</i>`;

    document.querySelector('#label')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('#plain')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('#broken')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(a.payloads).toEqual(['select x']);
    expect(a.keys).toEqual(['selectOffer']);
  });
});

describe('requests', () => {
  test('a same-origin fetch carries the consented destination names, a cross-origin one and nothing-consented do not', async () => {
    const calls: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    const original = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });

      return Promise.resolve(new Response('ok'));
    });

    vi.stubGlobal('fetch', original);

    const { configureRelay } = await installRelay();
    const choice = { a: true, b: false };

    configureRelay({
      destinations: { a: createDestination('a').destination, b: createDestination('b').destination },
      consent: testConsent(['a', 'b'], (name) => choice[name]),
    });

    await fetch('/_actions/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' } });
    await fetch(new Request(new URL('/api', window.location.href), { method: 'POST', headers: { accept: 'application/json' } }));
    await fetch('https://third.party/collect');

    choice.a = false;
    await fetch('/_actions/subscribe');

    expect(calls).toHaveLength(4);
    expect(new Headers(calls[0]?.init?.headers).get('x-relay-consent')).toBe('a');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(new Headers(calls[1]?.init?.headers).get('x-relay-consent')).toBe('a');
    expect(new Headers(calls[1]?.init?.headers).get('accept')).toBe('application/json');
    expect(calls[2]?.init).toBeUndefined();
    expect(calls[3]?.init).toBeUndefined();
  });

  test('a second module instance does not wrap the wrapper', async () => {
    const original = vi.fn(() => Promise.resolve(new Response('ok')));

    vi.stubGlobal('fetch', original);

    await installRelay();

    const once = globalThis.fetch;

    vi.stubGlobal('__relay__', undefined);
    await installRelay();

    expect(globalThis.fetch).toBe(once);
  });
});
