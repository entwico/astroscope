import { afterEach, describe, expect, test } from 'vitest';
import { cap } from './runtime';
import { normalizeCapPath } from './shared';

afterEach(() => cap.reset());

describe('cap.configure', () => {
  test('trims values and the trailing slash of the base url', () => {
    cap.configure({ baseUrl: ' https://cap.cap:3000/ ', siteKey: ' site ', secretKey: 'secret' });

    expect(cap.isConfigured()).toBe(true);
    expect(cap.getConfig()).toEqual({ baseUrl: 'https://cap.cap:3000', siteKey: 'site', secretKey: 'secret' });
  });

  test.each(['baseUrl', 'siteKey', 'secretKey'] as const)('requires %s', (key) => {
    const config = { baseUrl: 'http://cap', siteKey: 'site', secretKey: 'secret', [key]: ' ' };

    expect(() => cap.configure(config)).toThrow(key);
    expect(cap.isConfigured()).toBe(false);
  });

  test.each(['cap.cap:3000', '/cap', 'ftp://cap.cap', 'https://cap.cap?x=1', 'https://cap.cap/#cap'])(
    'rejects the base url %s',
    (baseUrl) => {
      expect(() => cap.configure({ baseUrl, siteKey: 'site', secretKey: 'secret' })).toThrow('baseUrl');
      expect(cap.isConfigured()).toBe(false);
    },
  );

  test('keeps a base path', () => {
    cap.configure({ baseUrl: 'https://cap.cap:3000/captcha/', siteKey: 'site', secretKey: 'secret' });

    expect(cap.getConfig()?.baseUrl).toBe('https://cap.cap:3000/captcha');
  });

  test.each(['a/b', 'a?b', 'a#b'])('rejects the site key %s', (siteKey) => {
    expect(() => cap.configure({ baseUrl: 'https://cap.cap', siteKey, secretKey: 'secret' })).toThrow('siteKey');
    expect(cap.isConfigured()).toBe(false);
  });
});

describe('normalizeCapPath', () => {
  test.each([
    ['/_cap/', '/_cap/'],
    ['/_cap', '/_cap/'],
    ['_cap', '/_cap/'],
    ['//api/cap//', '/api/cap/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCapPath(input)).toBe(expected);
  });

  test('rejects the root', () => {
    expect(() => normalizeCapPath('/')).toThrow();
  });
});
