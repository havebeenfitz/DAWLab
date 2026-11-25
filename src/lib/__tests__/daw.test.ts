import { describe, expect, it } from 'vitest';
import { dawInfo } from '../daw';

describe('dawInfo', () => {
  it.each([
    ['Logic Pro X', 'Logic Pro'],
    ['logic', 'Logic Pro'],
    ['Ableton', 'Ableton Live'],
    ['ableton live 12', 'Ableton Live'],
    ['fl', 'FL Studio'],
    ['FL Studio', 'FL Studio'],
    ['Reaper', 'Reaper'],
    ['protools', 'Pro Tools'],
    ['Pro Tools', 'Pro Tools'],
    ['  Logic Pro  ', 'Logic Pro'],
  ])('maps "%s" to %s with a logo', (label, name) => {
    const info = dawInfo(label);
    expect(info.name).toBe(name);
    expect(info.logo).toBeTruthy();
  });

  it('gives each known DAW its own logo', () => {
    const logos = ['Logic', 'Ableton', 'FL', 'Reaper', 'Pro Tools'].map((d) => dawInfo(d).logo);
    expect(new Set(logos).size).toBe(5);
  });

  it('keeps an unknown label without a logo', () => {
    expect(dawInfo('Bitwig Studio')).toEqual({ name: 'Bitwig Studio', logo: null });
  });

  it('does not treat near misses as known', () => {
    expect(dawInfo('FL Studio 21').logo).toBeNull();
    expect(dawInfo('Reaper 7').logo).toBeNull();
  });

  it.each([undefined, null, '', '   '])('says "your DAW" for %p', (label) => {
    expect(dawInfo(label as string | null | undefined)).toEqual({ name: 'your DAW', logo: null });
  });
});
