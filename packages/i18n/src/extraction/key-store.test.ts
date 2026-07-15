import type { AstroIntegrationLogger } from 'astro';
import { type Mock, describe, expect, test, vi } from 'vitest';
import { KeyStore } from './key-store.js';
import type { ExtractedKeyOccurrence } from './types.js';

const createMockLogger = () =>
  ({
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
    debug: () => {},
    label: 'test',
    fork() {
      return this;
    },
  }) as unknown as AstroIntegrationLogger & {
    warn: Mock;
    error: Mock;
  };

const createOccurrence = (
  key: string,
  file: string,
  line = 1,
  meta: ExtractedKeyOccurrence['meta'] = { fallback: `fallback for ${key}` },
): ExtractedKeyOccurrence => ({
  key,
  file,
  line,
  meta,
});

describe('KeyStore', () => {
  describe('addFileKeys', () => {
    test('adds keys for a new file', () => {
      const store = new KeyStore(createMockLogger());
      const keys = [createOccurrence('hello', 'a.ts'), createOccurrence('world', 'a.ts')];

      store.addFileKeys('a.ts', keys);

      expect(store.extractedKeys).toHaveLength(2);
      expect(store.extractedKeys.map((k) => k.key)).toEqual(['hello', 'world']);
      expect(store.fileToKeys.get('a.ts')).toEqual(['hello', 'world']);
      expect(store.filesWithI18n.has('a.ts')).toBe(true);
    });

    test('replaces keys for existing file', () => {
      const store = new KeyStore(createMockLogger());
      const oldKeys = [createOccurrence('old', 'a.ts')];
      const newKeys = [createOccurrence('new', 'a.ts')];

      store.addFileKeys('a.ts', oldKeys);
      store.addFileKeys('a.ts', newKeys);

      expect(store.extractedKeys).toHaveLength(1);
      expect(store.extractedKeys[0]?.key).toBe('new');
      expect(store.fileToKeys.get('a.ts')).toEqual(['new']);
    });

    test('handles empty keys array', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileKeys('a.ts', []);

      expect(store.extractedKeys).toEqual([]);
      expect(store.fileToKeys.get('a.ts')).toEqual([]);
      expect(store.filesWithI18n.has('a.ts')).toBe(true);
    });

    test('deduplicates keys within same file and collects all locations', () => {
      const store = new KeyStore(createMockLogger());
      const keys = [
        createOccurrence('title', 'a.ts', 10),
        createOccurrence('description', 'a.ts', 20),
        createOccurrence('title', 'a.ts', 30), // duplicate
      ];

      store.addFileKeys('a.ts', keys);

      expect(store.extractedKeys).toHaveLength(2);
      expect(store.extractedKeys.map((k) => k.key)).toEqual(['title', 'description']);

      // title should have both locations
      const titleKey = store.extractedKeys.find((k) => k.key === 'title');
      expect(titleKey?.files).toEqual(['a.ts:10', 'a.ts:30']);

      // last occurrence's meta wins
      expect(titleKey?.meta.fallback).toBe('fallback for title');

      expect(store.fileToKeys.get('a.ts')).toEqual(['title', 'description', 'title']);
    });

    test('keeps keys from other files when replacing', () => {
      const store = new KeyStore(createMockLogger());
      const keysA = [createOccurrence('a', 'a.ts')];
      const keysB = [createOccurrence('b', 'b.ts')];
      const newKeysA = [createOccurrence('a2', 'a.ts')];

      store.addFileKeys('a.ts', keysA);
      store.addFileKeys('b.ts', keysB);
      store.addFileKeys('a.ts', newKeysA);

      expect(store.extractedKeys).toHaveLength(2);
      expect(store.extractedKeys.map((k) => k.key)).toEqual(['b', 'a2']);
    });
  });

  describe('uniqueKeyCount', () => {
    test('counts unique keys', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileKeys('a.ts', [createOccurrence('hello', 'a.ts')]);
      store.addFileKeys('b.ts', [createOccurrence('world', 'b.ts')]);

      expect(store.uniqueKeyCount).toBe(2);
    });

    test('counts same key in different files once', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileKeys('a.ts', [createOccurrence('shared', 'a.ts')]);
      store.addFileKeys('b.ts', [createOccurrence('shared', 'b.ts')]);

      expect(store.uniqueKeyCount).toBe(1);
    });
  });

  describe('merge', () => {
    test('merges two stores', () => {
      const store1 = new KeyStore(createMockLogger());
      const store2 = new KeyStore(createMockLogger());

      store1.addFileKeys('a.ts', [createOccurrence('a', 'a.ts')]);
      store2.addFileKeys('b.ts', [createOccurrence('b', 'b.ts')]);

      store1.merge(store2);

      expect(store1.extractedKeys).toHaveLength(2);
      expect(store1.fileToKeys.size).toBe(2);
      expect(store1.filesWithI18n.size).toBe(2);
    });

    test('overwrites fileToKeys on merge', () => {
      const store1 = new KeyStore(createMockLogger());
      const store2 = new KeyStore(createMockLogger());

      store1.addFileKeys('a.ts', [createOccurrence('old', 'a.ts')]);
      store2.addFileKeys('a.ts', [createOccurrence('new', 'a.ts')]);

      store1.merge(store2);

      expect(store1.fileToKeys.get('a.ts')).toEqual(['new']);
    });

    test('merges same key from different files into one with multiple locations', () => {
      const store1 = new KeyStore(createMockLogger());
      const store2 = new KeyStore(createMockLogger());

      store1.addFileKeys('a.ts', [createOccurrence('shared', 'a.ts', 10)]);
      store2.addFileKeys('b.ts', [createOccurrence('shared', 'b.ts', 20)]);

      store1.merge(store2);

      expect(store1.extractedKeys).toHaveLength(1);
      expect(store1.extractedKeys[0]?.files).toEqual(['a.ts:10', 'b.ts:20']);
    });
  });

  describe('consistency check', () => {
    test('errors on inconsistent fallback by default', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger);

      store.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hi there' })]);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]?.[0]).toContain('inconsistent fallback');
      expect(logger.error.mock.calls[0]?.[0]).toContain('greeting');
      expect(store.hasErrors).toBe(true);
    });

    test('warns on inconsistent description', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'warn');

      store.addFileKeys('a.ts', [
        createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello', description: 'Greeting text' }),
      ]);
      store.addFileKeys('b.ts', [
        createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hello', description: 'Welcome message' }),
      ]);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain('inconsistent description');
    });

    test('warns on inconsistent variables', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'warn');

      store.addFileKeys('a.ts', [
        createOccurrence('greeting', 'a.ts', 10, {
          fallback: 'Hello {name}',
          variables: { name: { fallback: 'World' } },
        }),
      ]);
      store.addFileKeys('b.ts', [
        createOccurrence('greeting', 'b.ts', 20, {
          fallback: 'Hello {name}',
          variables: { name: { fallback: 'User' } },
        }),
      ]);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain('inconsistent variables');
    });

    test('errors on inconsistency when consistencyCheck is error', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'error');

      store.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hi there' })]);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]?.[0]).toContain('inconsistent fallback');
      expect(store.hasErrors).toBe(true);
    });

    test('does not check when consistencyCheck is off', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'off');

      store.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hi there' })]);

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(store.hasErrors).toBe(false);
    });

    test('does not warn when fallbacks are consistent', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'warn');

      store.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hello' })]);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('does not report same inconsistency twice', () => {
      const logger = createMockLogger();
      const store = new KeyStore(logger, 'warn');

      store.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hi' })]);
      store.addFileKeys('c.ts', [createOccurrence('greeting', 'c.ts', 30, { fallback: 'Hi' })]);

      // should only report once (a vs b), not again for a vs c or b vs c
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    test('checks consistency during merge', () => {
      const logger = createMockLogger();
      const store1 = new KeyStore(logger, 'warn');
      const store2 = new KeyStore(logger, 'warn');

      store1.addFileKeys('a.ts', [createOccurrence('greeting', 'a.ts', 10, { fallback: 'Hello' })]);
      store2.addFileKeys('b.ts', [createOccurrence('greeting', 'b.ts', 20, { fallback: 'Hi there' })]);

      store1.merge(store2);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain('inconsistent fallback');
    });
  });

  describe('extraction errors', () => {
    const createError = (key: string, file: string) => ({ key, file, line: 1, column: 0, reason: 'not static' });

    test('collects errors across files', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileErrors('a.ts', [createError('one', 'a.ts')]);
      store.addFileErrors('b.ts', [createError('two', 'b.ts')]);

      expect(store.extractionErrors.map((e) => e.key)).toEqual(['one', 'two']);
    });

    test('has no errors by default', () => {
      expect(new KeyStore(createMockLogger()).extractionErrors).toEqual([]);
    });

    test('replaces a file’s errors rather than accumulating them', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileErrors('a.ts', [createError('one', 'a.ts')]);
      store.addFileErrors('a.ts', [createError('one', 'a.ts')]);

      expect(store.extractionErrors).toHaveLength(1);
    });

    test('drops a file’s errors once it is fixed', () => {
      const store = new KeyStore(createMockLogger());

      store.addFileErrors('a.ts', [createError('one', 'a.ts')]);
      store.addFileErrors('a.ts', []);

      expect(store.extractionErrors).toEqual([]);
    });

    test('carries errors through merge', () => {
      const store = new KeyStore(createMockLogger());
      const other = new KeyStore(createMockLogger());

      other.addFileErrors('a.ts', [createError('one', 'a.ts')]);
      store.merge(other);

      expect(store.extractionErrors.map((e) => e.key)).toEqual(['one']);
    });
  });
});
