import { describe, expect, test } from 'vitest';
import { openai, toMinorUnits } from './shared.js';

describe('openai builders', () => {
  test('a contents event carries its items in minor units and the identifiers', () => {
    const event = openai.orderCreated({
      items: [{ id: 'S1', name: 'Seminar', price: 129.99, quantity: 1 }],
      value: 129.99,
      currency: 'EUR',
      contentType: 'seminar',
      user: { email: 'a@b.c' },
    });

    expect(event).toEqual({
      name: 'order_created',
      data: {
        type: 'contents',
        amount: 12_999,
        currency: 'EUR',
        contents: [{ id: 'S1', name: 'Seminar', content_type: 'seminar', quantity: 1, amount: 12_999, currency: 'EUR' }],
      },
      user: { email: 'a@b.c' },
    });
  });

  test('sums the items when no value is given, products by default', () => {
    const event = openai.itemsAdded({ items: [{ id: 'a', name: 'A', price: 10, quantity: 2 }], currency: 'EUR' });

    expect(event.data).toMatchObject({ amount: 2000, contents: [{ content_type: 'product' }] });
    expect(event.user).toBeUndefined();
  });

  test('a lead carries no contents', () => {
    expect(openai.leadCreated({ phone: '0171' })).toEqual({ name: 'lead_created', data: { type: 'customer_action' }, user: { phone: '0171' } });
  });

  test('a page view carries the page as its only content', () => {
    expect(openai.pageViewed({ id: '/seminare', name: 'Seminare' })).toEqual({
      name: 'page_viewed',
      data: { type: 'contents', contents: [{ id: '/seminare', name: 'Seminare', content_type: 'page' }] },
    });
  });

  test('the customer actions take the identifiers and, where one has a value, the money', () => {
    expect(openai.registrationCompleted({ email: 'a@b.c' })).toEqual({
      name: 'registration_completed',
      data: { type: 'customer_action' },
      user: { email: 'a@b.c' },
    });
    expect(openai.appointmentScheduled(undefined, { value: 50, currency: 'EUR' }).data).toEqual({
      type: 'customer_action',
      amount: 5000,
      currency: 'EUR',
    });
  });

  test('a plan enrollment carries the plan, its money and its items as plans', () => {
    expect(openai.subscriptionCreated({ id: 'pro', money: { value: 20, currency: 'USD' }, items: [{ id: 'pro', name: 'Pro', price: 20, quantity: 1 }] })).toEqual({
      name: 'subscription_created',
      data: {
        type: 'plan_enrollment',
        plan_id: 'pro',
        amount: 2000,
        currency: 'USD',
        contents: [{ id: 'pro', name: 'Pro', content_type: 'plan', quantity: 1, amount: 2000, currency: 'USD' }],
      },
      user: undefined,
    });
    expect(openai.trialStarted({ id: 'trial' }).data).toEqual({ type: 'plan_enrollment', plan_id: 'trial' });
  });

  test('a custom event carries its name apart from the type', () => {
    expect(openai.custom('quote_requested')).toEqual({ name: 'custom', customName: 'quote_requested', data: { type: 'custom', plan_id: undefined }, user: undefined });
    expect(openai.custom('quote_requested', { money: { value: 1, currency: 'CHF' }, user: { phone: '1' } })).toMatchObject({
      data: { type: 'custom', amount: 100, currency: 'CHF' },
      user: { phone: '1' },
    });
  });

  test('rounds to the minor unit', () => {
    expect(openai.contentsViewed({ items: [{ id: '1', name: 'x', price: 0.1 + 0.2, quantity: 1 }], value: 0.3, currency: 'CHF' }).data)
      .toMatchObject({ amount: 30, contents: [{ amount: 30 }] });
  });

  test('the minor unit follows the currency', () => {
    const item = (price: number) => [{ id: '1', name: 'x', price, quantity: 1 }];

    expect(openai.orderCreated({ items: item(1000), currency: 'JPY' }).data).toMatchObject({ amount: 1000, contents: [{ amount: 1000 }] });
    expect(openai.orderCreated({ items: item(1.5), currency: 'KWD' }).data).toMatchObject({ amount: 1500, contents: [{ amount: 1500 }] });
    expect(openai.leadCreated(undefined, { value: 1.5, currency: 'XYZ' }).data).toMatchObject({ amount: 150 });
    expect(toMinorUnits(1.5)).toBe(150);
  });

  test('a custom event name outside the rule or taken by a standard event is rejected', () => {
    expect(() => openai.custom('Quote Requested')).toThrow(TypeError);
    expect(() => openai.custom('')).toThrow(TypeError);
    expect(() => openai.custom('a'.repeat(65))).toThrow(TypeError);
    expect(() => openai.custom('lead_created')).toThrow('standard');
    expect(openai.custom('quote-requested_2')).toMatchObject({ customName: 'quote-requested_2' });
  });
});
