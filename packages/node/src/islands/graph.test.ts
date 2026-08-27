import { describe, expect, test } from 'vitest';
import { createChunkGraph } from './graph';

const graph = createChunkGraph({
  runtimeSource: '/* gate runtime */',
  chunks: {
    'a.js': { i: ['b.js'], d: ['lazy.js'] },
    'b.js': { i: ['c.js', 'shared.js'] },
    'c.js': { i: ['shared.js'] },
    'shared.js': {},
    'lazy.js': { i: ['shared.js'] },
    'x.js': { i: ['y.js'] },
    'y.js': { i: ['x.js'] },
  },
});

describe('createChunkGraph', () => {
  test('static closure walks transitive static imports, deduped, self excluded', () => {
    expect(graph.staticClosure('a.js').sort()).toEqual(['b.js', 'c.js', 'shared.js']);
  });

  test('static closure ignores dynamic imports', () => {
    expect(graph.staticClosure('a.js')).not.toContain('lazy.js');
  });

  test('full closure crosses dynamic import boundaries', () => {
    expect(graph.fullClosure('a.js').sort()).toEqual(['b.js', 'c.js', 'lazy.js', 'shared.js']);
  });

  test('survives import cycles', () => {
    expect(graph.staticClosure('x.js').sort()).toEqual(['y.js']);
    expect(graph.staticClosure('y.js').sort()).toEqual(['x.js']);
  });

  test('unknown chunks resolve to an empty closure', () => {
    expect(graph.staticClosure('missing.js')).toEqual([]);
    expect(graph.has('missing.js')).toBe(false);
    expect(graph.has('a.js')).toBe(true);
  });
});
