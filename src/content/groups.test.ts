import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { availableGroups, exerciseGroup } from './groups';
import { composeModel, toSources } from './manifest';
import { rhythmicAlphabetItems } from './rhythmic-alphabet';
import type { ImageDescriptorFile, RhythmicAlphabetDescriptor } from './types';

const read = (file: string) => JSON.parse(readFileSync(`public/content/${file}`, 'utf8'));

describe('book groups', () => {
  it('covers every shipped Stick Control image in four technique groups, separately from Benny Greb', () => {
    const files: string[] = read('manifest.json');
    const sources = files.filter((file) => file !== 'benny_greb.json')
      .flatMap((file) => toSources(file, read(file) as ImageDescriptorFile));
    const alphabet = rhythmicAlphabetItems(read('benny_greb.json') as RhythmicAlphabetDescriptor);
    const model = composeModel(sources, alphabet);
    expect(availableGroups(model.items).map((group) => group.id)).toEqual([
      'stick-basics', 'stick-rolls', 'stick-flams', 'stick-meters', 'benny-greb',
    ]);
    expect(model.items.every((item) => item.rhythm
      ? exerciseGroup(item) === 'benny-greb'
      : exerciseGroup(item).startsWith('stick-'))).toBe(true);
    for (const [page, group] of [['5', 'stick-basics'], ['10', 'stick-rolls'], ['16', 'stick-flams'], ['33', 'stick-meters']]) {
      expect(model.itemsByPage.get(page)!.every((item) => exerciseGroup(item) === group)).toBe(true);
    }
  });
});
