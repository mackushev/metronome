import type { Item, Topic } from './types';

/** Practice collections, grouped by technique within each book. */
const GROUPS = [
  { id: 'stick-basics', title: 'Stick Control · Stickings & triplets', topics: [
    'Single Beat Combinations', 'Triplets',
  ] },
  { id: 'stick-rolls', title: 'Stick Control · Rolls & progressions', topics: [
    'Short Roll Combinations (Single Beat Rolls)', 'Short Roll Combinations (Double Beat Rolls)',
    'Short Roll Combinations', 'Review of Short Roll Combinations', 'Short Rolls and Triplets',
    'Short Roll Progressions', 'Short Roll Progressions and Triplets',
  ] },
  { id: 'stick-flams', title: 'Stick Control · Flams', topics: [
    'Flam Beats', 'Flam Triplets and Dotted Notes',
  ] },
  { id: 'stick-meters', title: 'Stick Control · 6/8, 3/8 & 2/4', topics: [
    'Short Rolls in 6/8', 'Review of Short Rolls in 6/8', 'Combinations in 3/8', 'Combinations in 2/4',
  ] },
  { id: 'benny-greb', title: 'Benny Greb · Rhythmic alphabet', topics: [] },
  { id: 'other', title: 'Other exercises', topics: [] },
];

export function exerciseGroup(item: Item): string {
  if (item.rhythm) return 'benny-greb';
  return GROUPS.find((group) => group.topics.includes(item.topic))?.id ?? 'other';
}

export function availableGroups(items: Item[]): Topic[] {
  const present = new Set(items.map(exerciseGroup));
  return GROUPS.filter((group) => present.has(group.id)).map(({ id, title }) => ({ id, title }));
}
