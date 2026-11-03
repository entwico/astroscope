import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type ConsentRecord, type ConsentSource, type DestinationName, type EventMeta, defineEvent } from '../shared.js';
import { testConsent } from '../test-destinations.js';
import { type Bus, type Destination, createBus } from './bus.js';

type Delivery = { payload: string; meta: EventMeta };

type TestName = Extract<DestinationName, 'a' | 'b' | 'c' | 'free'>;

const NAMES: readonly TestName[] = ['a', 'b', 'c', 'free'];

/** a stand-in for a cmp: the choice by destination name, `undefined` until the visitor chose */
type Choice = {
  current: ConsentRecord | undefined;
  set: (next: ConsentRecord | undefined) => void;
  source: ConsentSource<TestName>;
};

function createChoice(initial: ConsentRecord | undefined, free: readonly TestName[] = []): Choice {
  const choice: Choice = {
    current: initial,
    set: (next) => {
      choice.current = next;
    },
    source: testConsent(NAMES, (name) => choice.current?.[name], free),
  };

  return choice;
}

const given = testConsent(NAMES);

function createDestination<N extends TestName>(name: N, options: Partial<Destination<N>> = {}) {
  const deliveries: Delivery[] = [];
  const destination: Destination<N> = {
    name,
    send: (payload, meta) => void deliveries.push({ payload, meta }),
    ...options,
  };

  return { destination, deliveries, payloads: () => deliveries.map(({ payload }) => payload) };
}

let scheduled: (() => void)[];

function createTestBus(): Bus {
  return createBus({
    now: () => 1000,
    schedule: (callback) => {
      scheduled.push(callback);

      return () => {
        scheduled = scheduled.filter((entry) => entry !== callback);
      };
    },
  });
}

function runScheduled(): void {
  const pending = scheduled;

  scheduled = [];

  for (const callback of pending) callback();
}

beforeEach(() => {
  scheduled = [];
});

describe('delivery', () => {
  test('a destination gets the payload meant for it, under the event meta, and only that', () => {
    const bus = createTestBus();
    const a = createDestination('a');
    const b = createDestination('b');

    bus.configure({ destinations: { a: a.destination, b: b.destination }, consent: given });

    const id = bus.track({ a: 'for a', b: 'for b' });

    bus.track({ a: 'a only' });

    expect(a.payloads()).toEqual(['for a', 'a only']);
    expect(b.payloads()).toEqual(['for b']);
    expect(a.deliveries[0]?.meta).toEqual({ id, at: 1000, key: undefined });
  });

  test('events tracked before the destinations are registered are delivered on configure', () => {
    const bus = createTestBus();
    const a = createDestination('a');

    bus.track({ a: 'early' });
    bus.configure({ destinations: { a: a.destination }, consent: given });

    expect(a.payloads()).toEqual(['early']);
  });

  test('a declined destination gets nothing, an unanswered one waits and gets what came before on notify', () => {
    const bus = createTestBus();
    const choice = createChoice(undefined);
    const a = createDestination('a');
    const b = createDestination('b');

    bus.configure({ destinations: { a: a.destination, b: b.destination }, consent: choice.source });
    bus.track({ a: 'x', b: 'x' });

    expect(a.payloads()).toEqual([]);
    expect(scheduled).toHaveLength(1);

    choice.set({ a: true, b: false });
    bus.notify();

    expect(a.payloads()).toEqual(['x']);
    expect(b.payloads()).toEqual([]);
  });

  test('a failing destination is reported and does not stop the others', () => {
    const bus = createTestBus();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = createDestination('a', {
      send: () => {
        throw new Error('down');
      },
    });
    const b = createDestination('b');

    bus.configure({ destinations: { a: a.destination, b: b.destination }, consent: given });
    bus.track({ a: 'x', b: 'x' });

    expect(b.payloads()).toEqual(['x']);
    expect(error).toHaveBeenCalledWith('relay: destination a failed', expect.any(Error));
    error.mockRestore();
  });

  test('debug logs one group per event with what each destination got or why not, and late deliveries', () => {
    const bus = createTestBus();
    const choice = createChoice({ a: true, b: false, c: true });
    const a = createDestination('a');
    const b = createDestination('b');
    const c = createDestination('c', { ready: () => false });
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hello = defineEvent('hello', (to: string) => ({ a: `hello ${to}`, b: 'x', c: 'x' }));

    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    bus.configure({
      destinations: { a: a.destination, b: b.destination, c: c.destination },
      consent: choice.source,
      debug: true,
    });

    const id = bus.track(hello('bus'));

    expect(group).toHaveBeenCalledWith(`%crelay hello #${id} → sent to 1 of 3`, expect.any(String));
    expect(log.mock.calls.map(([line, , ...rest]) => [line, ...rest])).toEqual([
      ['%c>>', { key: 'hello', event: { a: 'hello bus', b: 'x', c: 'x' } }],
      ['%c<< a', 'hello bus', ''],
      ['%c<< b', 'declined', 'x'],
      ['%c<< c', 'waiting for sdk', 'x'],
    ]);
    expect(log.mock.calls[2]?.[1]).toContain('line-through');

    choice.set({ a: true, b: true, c: true });
    bus.notify();

    expect(group).toHaveBeenLastCalledWith(`%crelay hello #${id} → b, later`, expect.any(String));
    vi.restoreAllMocks();
  });

  test('configuring again delivers nothing a destination already got', () => {
    const bus = createTestBus();
    const a = createDestination('a');

    bus.configure({ destinations: { a: a.destination }, consent: given });
    bus.track({ a: 'x' });
    bus.configure({ destinations: { a: a.destination }, consent: given });

    expect(a.payloads()).toEqual(['x']);
  });

  test('configuring again with the same source watches it once', () => {
    const bus = createTestBus();
    const watch = vi.fn();
    const consent = { ...given, watch };

    bus.configure({ destinations: { a: createDestination('a').destination }, consent });
    bus.configure({ destinations: { a: createDestination('a').destination }, consent });

    expect(watch).toHaveBeenCalledTimes(1);
  });
});

describe('defined events', () => {
  test('a defined event is delivered with its key, a plain one without', () => {
    const bus = createTestBus();
    const a = createDestination('a');
    const newsletter = defineEvent('newsletter', () => ({ a: 'sign_up' }));

    bus.configure({ destinations: { a: a.destination }, consent: given });
    bus.track(newsletter());
    bus.track({ a: 'plain' });

    expect(a.deliveries.map(({ meta }) => meta.key)).toEqual(['newsletter', undefined]);
  });
});

describe('consent-free destinations', () => {
  test('take events before the cmp has answered and are not in the consent record', () => {
    const bus = createTestBus();
    const free = createDestination('free');
    const a = createDestination('a');

    bus.configure({ destinations: { free: free.destination, a: a.destination }, consent: createChoice(undefined, ['free']).source });
    bus.track({ free: 'x', a: 'x' });

    expect(free.payloads()).toEqual(['x']);
    expect(a.payloads()).toEqual([]);
    expect(bus.consent()).toEqual({ a: false });
  });

  test('watch hands out the re-check, so a changed choice delivers at once', () => {
    const bus = createTestBus();
    const choice = createChoice(undefined);
    const a = createDestination('a');
    let notify: (() => void) | undefined;

    bus.configure({
      destinations: { a: a.destination },
      consent: { ...choice.source, watch: (fn) => void (notify = fn) },
    });
    bus.track({ a: 'x' });

    expect(a.payloads()).toEqual([]);

    choice.set({ a: true });
    notify?.();

    expect(a.payloads()).toEqual(['x']);
  });

  test('a destination must sit under its own name and have a consent source', () => {
    const bus = createTestBus();

    expect(() => bus.configure({ destinations: { a: createDestination('b').destination as never }, consent: given })).toThrow(
      'relay: destination b is registered under a',
    );
    expect(() => bus.configure({ destinations: { a: createDestination('a').destination }, consent: testConsent(['b']) })).toThrow(
      'relay: destination a has no consent source',
    );
  });
});

describe('readiness', () => {
  test('a destination whose sdk is not there yet is polled and gets its events once it is', () => {
    const bus = createTestBus();
    let loaded = false;
    const a = createDestination('a', { ready: () => loaded });

    bus.configure({ destinations: { a: a.destination }, consent: given });
    bus.track({ a: 'x' });

    expect(a.payloads()).toEqual([]);
    expect(scheduled).toHaveLength(1);

    runScheduled();
    expect(a.payloads()).toEqual([]);
    expect(scheduled).toHaveLength(1);

    loaded = true;
    runScheduled();
    expect(a.payloads()).toEqual(['x']);
    expect(scheduled).toEqual([]);
  });

  test('the poll gives up after the attempts and resumes on the next event or notify', () => {
    const bus = createTestBus();
    const a = createDestination('a', { ready: () => false });

    bus.configure({ destinations: { a: a.destination }, consent: given });
    bus.track({ a: 'x' });

    for (let attempt = 0; attempt < 100; attempt += 1) runScheduled();

    expect(scheduled).toEqual([]);

    bus.notify();
    expect(scheduled).toHaveLength(1);
  });

  test('a choice through watch after the poll gave up starts it over', () => {
    const bus = createTestBus();
    const choice = createChoice(undefined);
    let ready = false;
    const a = createDestination('a', { ready: () => ready });
    let notify: (() => void) | undefined;

    bus.configure({
      destinations: { a: a.destination },
      consent: { ...choice.source, watch: (fn) => void (notify = fn) },
    });
    bus.track({ a: 'x' });

    for (let attempt = 0; attempt < 100; attempt += 1) runScheduled();

    expect(scheduled).toEqual([]);

    choice.set({ a: true });
    notify?.();

    expect(scheduled).toHaveLength(1);

    ready = true;
    runScheduled();

    expect(a.payloads()).toEqual(['x']);
  });
});

describe('ids', () => {
  test('an event fires under its own id when it carries a usable one, else under a fresh one and the reason is logged', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createTestBus();
    const a = createDestination('a');

    bus.configure({ destinations: { a: a.destination }, consent: given });

    const purchase = defineEvent('purchase', (order: string) => ({ id: order, a: 'purchase' }));

    expect(bus.track(purchase('order-9'))).toBe('order-9');
    expect(bus.track(purchase(''))).not.toBe('');
    expect(bus.track(purchase('not valid!'))).not.toBe('not valid!');
    expect(a.deliveries.map(({ meta }) => meta.id)).toEqual(['order-9', expect.any(String), expect.any(String)]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[1]?.[0]).toContain('"not valid!"');

    error.mockRestore();
  });

  test('two different events under the same own id both reach the destination', () => {
    const bus = createTestBus();
    const a = createDestination('a');
    const checkout = defineEvent('checkout', (order: string) => ({ id: order, a: 'begin_checkout' }));
    const purchase = defineEvent('purchase', (order: string) => ({ id: order, a: 'purchase' }));

    bus.configure({ destinations: { a: a.destination }, consent: given });
    bus.track(checkout('order-9'));
    bus.track(purchase('order-9'));

    expect(a.deliveries.map(({ payload, meta }) => [payload, meta.key])).toEqual([
      ['begin_checkout', 'checkout'],
      ['purchase', 'purchase'],
    ]);
  });
});

describe('consent', () => {
  test('is the choice as known, by destination name; an unknown answer is not given', () => {
    const bus = createTestBus();

    expect(bus.consent()).toEqual({});

    const choice = createChoice({ a: true, b: false });

    bus.configure({
      destinations: { a: createDestination('a').destination, b: createDestination('b').destination, c: createDestination('c').destination },
      consent: choice.source,
    });

    expect(bus.consent()).toEqual({ a: true, b: false, c: false });

    choice.set({ a: false, b: true });

    expect(bus.consent()).toEqual({ a: false, b: true, c: false });
  });
});
