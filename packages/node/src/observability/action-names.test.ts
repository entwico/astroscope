import { describe, expect, test } from 'vitest';
import { collectActionNames, resolveActionName } from './action-names';

describe('collectActionNames', () => {
  test('names every function by its key path', () => {
    const server = {
      like: () => {},
      user: { update: () => {}, profile: { avatar: () => {} } },
      meta: 'not an action',
    };

    expect([...collectActionNames(server)].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'like',
      'user.profile.avatar',
      'user.update',
    ]);
  });

  test('a function is a leaf, its properties are no actions', () => {
    const like = Object.assign(() => {}, { orThrow: () => {} });

    expect([...collectActionNames({ like })]).toEqual(['like']);
  });

  test('a registry that is no object has no names', () => {
    expect(collectActionNames(undefined).size).toBe(0);
    expect(collectActionNames('server').size).toBe(0);
  });
});

describe('resolveActionName', () => {
  const actions = new Set(['like', 'user.update']);

  test('keeps a known name, with the trailing slash dropped', () => {
    expect(resolveActionName('user.update/', actions)).toBe('user.update');
  });

  test('decodes the path keys before the lookup', () => {
    expect(resolveActionName('user%2Eupdate', new Set(['user.update']))).toBe('user.update');
  });

  test('buckets unknown and undecodable names', () => {
    expect(resolveActionName('made-up', actions)).toBe('unknown');
    expect(resolveActionName('%', actions)).toBe('unknown');
  });

  test('takes every name as it is without a registry', () => {
    expect(resolveActionName('made-up/', undefined)).toBe('made-up');
  });
});
