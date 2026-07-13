import { describe, expect, test } from 'vitest';
import { resolveClientDir } from './client-dir';

const options = {
  client: 'file:///build/project/dist/client/',
  server: 'file:///build/project/dist/server/',
};

describe('resolveClientDir', () => {
  test('resolves the client dir when deployed under a different path than the build machine', () => {
    expect(resolveClientDir(options, 'file:///app/dist/server/entry.mjs')).toBe('/app/dist/client/');
  });

  test('walks up from entries nested below the server dir', () => {
    expect(resolveClientDir(options, 'file:///app/dist/server/chunks/pages/index.mjs')).toBe('/app/dist/client/');
  });

  test('resolves on the build machine itself', () => {
    expect(resolveClientDir(options, 'file:///build/project/dist/server/entry.mjs')).toBe(
      '/build/project/dist/client/',
    );
  });

  test('preserves a non-sibling server-to-client relative layout', () => {
    const custom = {
      client: 'file:///build/project/static/',
      server: 'file:///build/project/out/server/',
    };

    expect(resolveClientDir(custom, 'file:///app/out/server/entry.mjs')).toBe('/app/static/');
  });

  test('throws when the server directory cannot be found above the entry', () => {
    expect(() => resolveClientDir(options, 'file:///app/elsewhere/entry.mjs')).toThrow(
      /could not find the server directory "server" by walking up from "file:\/\/\/app\/elsewhere\/entry\.mjs"/,
    );
  });
});
