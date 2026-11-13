import { describe, expect, it } from 'vitest';
import { COLUMNS } from './board';

describe('COLUMNS', () => {
  it('lists the three columns, in board order, with their titles', () => {
    expect(COLUMNS.map((column) => [column.id, column.title])).toEqual([
      ['todo', 'To do'],
      ['doing', 'Doing'],
      ['done', 'Done'],
    ]);
  });
});
