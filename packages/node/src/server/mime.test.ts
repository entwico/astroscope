import { describe, expect, test } from 'vitest';
import { COMPRESSIBLE, MIME_TYPES } from './mime';

describe('MIME_TYPES', () => {
  test('maps common extensions to their content types', () => {
    expect(MIME_TYPES.get('.html')).toBe('text/html; charset=utf-8');
    expect(MIME_TYPES.get('.js')).toBe('application/javascript; charset=utf-8');
    expect(MIME_TYPES.get('.mjs')).toBe('application/javascript; charset=utf-8');
    expect(MIME_TYPES.get('.png')).toBe('image/png');
    expect(MIME_TYPES.get('.jpg')).toBe('image/jpeg');
    expect(MIME_TYPES.get('.woff2')).toBe('font/woff2');
    expect(MIME_TYPES.get('.pdf')).toBe('application/pdf');
  });

  test('returns undefined for unknown extensions', () => {
    expect(MIME_TYPES.get('.exe')).toBeUndefined();
    expect(MIME_TYPES.get('html')).toBeUndefined();
  });

  test('all keys are lowercase dot-prefixed extensions', () => {
    for (const ext of MIME_TYPES.keys()) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
    }
  });

  test('text formats carry a utf-8 charset', () => {
    for (const ext of ['.html', '.css', '.js', '.json', '.xml', '.svg', '.txt']) {
      expect(MIME_TYPES.get(ext)).toContain('charset=utf-8');
    }
  });

  test('binary formats carry no charset', () => {
    for (const ext of ['.png', '.woff2', '.mp4', '.pdf', '.wasm']) {
      expect(MIME_TYPES.get(ext)).not.toContain('charset');
    }
  });
});

describe('COMPRESSIBLE', () => {
  test('every compressible extension has a mime type', () => {
    for (const ext of COMPRESSIBLE) {
      expect(MIME_TYPES.get(ext)).toBeDefined();
    }
  });

  test('contains text formats', () => {
    for (const ext of ['.html', '.css', '.js', '.json', '.svg', '.map']) {
      expect(COMPRESSIBLE.has(ext)).toBe(true);
    }
  });

  test('excludes already-compressed binary formats', () => {
    for (const ext of ['.png', '.jpg', '.webp', '.woff', '.woff2', '.mp4', '.mp3', '.pdf']) {
      expect(COMPRESSIBLE.has(ext)).toBe(false);
    }
  });
});
