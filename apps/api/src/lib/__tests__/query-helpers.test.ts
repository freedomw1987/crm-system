import { describe, it, expect } from 'bun:test';
import { toIdArray } from '../query-helpers';

describe('toIdArray', () => {
  it('returns [] for undefined', () => {
    expect(toIdArray(undefined)).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(toIdArray(null)).toEqual([]);
  });

  it('passes a string[] through unchanged', () => {
    expect(toIdArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('splits a single comma-separated string into a string[]', () => {
    expect(toIdArray('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around each id', () => {
    expect(toIdArray('  a , b ,  c  ')).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty strings', () => {
    expect(toIdArray('a,,b,,,c')).toEqual(['a', 'b', 'c']);
    expect(toIdArray(['', 'a', '', 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] when the input is only empty strings', () => {
    expect(toIdArray('')).toEqual([]);
    expect(toIdArray(',,,')).toEqual([]);
    expect(toIdArray(['', '', ''])).toEqual([]);
  });

  it('handles a single id (no comma)', () => {
    expect(toIdArray('abc')).toEqual(['abc']);
  });
});
