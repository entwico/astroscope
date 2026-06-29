import { describe, expect, test } from 'vitest';

import { computeRobots } from './robots';

describe('computeRobots', () => {
  test('the permissive default yields no directives, so no tag is rendered', () => {
    expect(computeRobots({})).toEqual([]);
    expect(computeRobots({ index: true, follow: true })).toEqual([]);
  });

  test('noindex is emitted when index is false', () => {
    expect(computeRobots({ index: false })).toEqual(['noindex']);
  });

  test('nofollow is emitted when follow is false', () => {
    expect(computeRobots({ follow: false })).toEqual(['nofollow']);
  });

  test('both restrictions combine', () => {
    expect(computeRobots({ index: false, follow: false })).toEqual(['noindex', 'nofollow']);
  });

  test('positive defaults are never emitted — noindex alone implies follow', () => {
    expect(computeRobots({ index: false, follow: true })).toEqual(['noindex']);
  });

  test('unavailable_after normalizes a date string to ISO 8601 (UTC)', () => {
    // a date-only ISO string is parsed as UTC, so the result is timezone-stable
    expect(computeRobots({ unavailableAfter: '2030-01-01' })).toEqual(['unavailable_after: 2030-01-01T00:00:00.000Z']);
  });

  test('unavailable_after accepts a Date instance', () => {
    expect(computeRobots({ unavailableAfter: new Date('2030-06-15T12:00:00Z') })).toEqual([
      'unavailable_after: 2030-06-15T12:00:00.000Z',
    ]);
  });

  test('the normalized directive never contains a comma, whatever the input', () => {
    const [directive] = computeRobots({ unavailableAfter: new Date('2030-06-15T12:00:00Z') });

    expect(directive).not.toContain(',');
  });

  test('an unparseable date is dropped rather than emitting garbage', () => {
    expect(computeRobots({ unavailableAfter: 'not a date' })).toEqual([]);
    expect(computeRobots({ follow: false, unavailableAfter: 'not a date' })).toEqual(['nofollow']);
  });

  test('unavailable_after is dropped on a noindex page, where it is contradictory', () => {
    expect(computeRobots({ index: false, unavailableAfter: '2030-01-01' })).toEqual(['noindex']);
  });

  test('unavailable_after coexists with nofollow on an indexable page', () => {
    expect(computeRobots({ follow: false, unavailableAfter: '2030-01-01' })).toEqual([
      'nofollow',
      'unavailable_after: 2030-01-01T00:00:00.000Z',
    ]);
  });
});
