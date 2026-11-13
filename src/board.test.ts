import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  addCard,
  deleteCard,
  editCard,
  emptyBoard,
  isOverLimit,
  isValidDue,
  isValidWipLimit,
  moveCard,
  setWipLimit,
  type Board,
  type Card,
  type ColumnId,
} from './board';

describe('COLUMNS', () => {
  it('lists the three columns, in board order, with their titles', () => {
    expect(COLUMNS.map((column) => [column.id, column.title])).toEqual([
      ['todo', 'To do'],
      ['doing', 'Doing'],
      ['done', 'Done'],
    ]);
  });
});

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}

const card = (id: string): Card => ({ id, title: `Card ${id}`, note: '', due: null });

const board: Board = deepFreeze({
  version: 1,
  columns: {
    todo: { wipLimit: null, cards: [card('a'), card('b')] },
    doing: { wipLimit: 3, cards: [card('c')] },
    done: { wipLimit: null, cards: [card('d'), card('e')] },
  },
});

const ids = (of: Board, column: ColumnId) => of.columns[column].cards.map((item) => item.id);

describe('frozen fixture', () => {
  it('is frozen all the way down', () => {
    expect(Object.isFrozen(board)).toBe(true);
    expect(Object.isFrozen(board.columns.todo.cards)).toBe(true);
    expect(Object.isFrozen(board.columns.todo.cards[0])).toBe(true);
  });
});

describe('emptyBoard', () => {
  it('has three columns in COLUMNS order, no limits, no cards', () => {
    expect(emptyBoard()).toEqual({
      version: 1,
      columns: {
        todo: { wipLimit: null, cards: [] },
        doing: { wipLimit: null, cards: [] },
        done: { wipLimit: null, cards: [] },
      },
    });
    expect(Object.keys(emptyBoard().columns)).toEqual(COLUMNS.map((column) => column.id));
  });

  it('returns a new board every time', () => {
    const first = emptyBoard();
    const second = emptyBoard();
    expect(first).not.toBe(second);
    expect(first.columns.todo.cards).not.toBe(second.columns.todo.cards);
  });
});

describe('addCard', () => {
  it('appends to the end of the chosen column, leaves the rest alone', () => {
    const next = addCard(board, 'doing', card('f'));
    expect(ids(next, 'doing')).toEqual(['c', 'f']);
    expect(ids(next, 'todo')).toEqual(['a', 'b']);
    expect(ids(next, 'done')).toEqual(['d', 'e']);
    expect(next.columns.doing.wipLimit).toBe(3);
  });

  it('trims title and note, keeps id and due', () => {
    const next = addCard(deepFreeze(emptyBoard()), 'todo', {
      id: 'x',
      title: '  Write docs \t',
      note: '\n a\n\nb  ',
      due: '2024-02-29',
    });
    expect(next.columns.todo.cards).toEqual([{ id: 'x', title: 'Write docs', note: 'a\n\nb', due: '2024-02-29' }]);
  });

  it('turns a whitespace-only note into an empty string', () => {
    const next = addCard(deepFreeze(emptyBoard()), 'todo', { id: 'x', title: 'T', note: ' \n\t ', due: null });
    expect(next.columns.todo.cards[0].note).toBe('');
  });

  it.each(['', '   ', '\t\n'])('refuses the blank title %j', (title) => {
    expect(() => addCard(board, 'todo', { id: 'x', title, note: '', due: null })).toThrow(RangeError);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-2-3', ''])('refuses the due date %j', (due) => {
    expect(() => addCard(board, 'todo', { id: 'x', title: 'T', note: '', due })).toThrow(RangeError);
  });
});

describe('editCard', () => {
  it('replaces title, note and due of that card only', () => {
    const next = editCard(board, 'b', { title: ' New ', note: ' n ', due: '2026-05-01' });
    expect(next.columns.todo.cards).toEqual([card('a'), { id: 'b', title: 'New', note: 'n', due: '2026-05-01' }]);
    expect(next.columns.doing).toEqual(board.columns.doing);
    expect(next.columns.done).toEqual(board.columns.done);
  });

  it('refuses a blank title and an invalid due', () => {
    expect(() => editCard(board, 'b', { title: '  ', note: '', due: null })).toThrow(RangeError);
    expect(() => editCard(board, 'b', { title: 'T', note: '', due: '2026-02-30' })).toThrow(RangeError);
  });

  it('returns the same board for an unknown id', () => {
    expect(editCard(board, 'zzz', { title: 'T', note: '', due: null })).toBe(board);
  });
});

describe('deleteCard', () => {
  it('removes that card, keeps the order of the others', () => {
    const next = deleteCard(board, 'd');
    expect(ids(next, 'done')).toEqual(['e']);
    expect(ids(next, 'todo')).toEqual(['a', 'b']);
    expect(ids(next, 'doing')).toEqual(['c']);
  });

  it('returns the same board for an unknown id', () => {
    expect(deleteCard(board, 'zzz')).toBe(board);
  });
});

describe('moveCard', () => {
  it('removes from its column, appends to the end of the target', () => {
    const next = moveCard(board, 'd', 'todo');
    expect(ids(next, 'todo')).toEqual(['a', 'b', 'd']);
    expect(ids(next, 'done')).toEqual(['e']);
    expect(ids(next, 'doing')).toEqual(['c']);
    expect(next.columns.doing.wipLimit).toBe(3);
  });

  it('keeps every other card where it was', () => {
    const next = moveCard(board, 'a', 'done');
    expect(ids(next, 'todo')).toEqual(['b']);
    expect(ids(next, 'done')).toEqual(['d', 'e', 'a']);
    expect(next.columns.done.cards[2]).toEqual(card('a'));
  });

  it('returns the same board object when the card is already in that column', () => {
    expect(moveCard(board, 'b', 'todo')).toBe(board);
  });

  it('returns the same board for an unknown id', () => {
    expect(moveCard(board, 'zzz', 'done')).toBe(board);
  });
});

describe('setWipLimit', () => {
  it('sets that column only', () => {
    const next = setWipLimit(board, 'todo', 2);
    expect(next.columns.todo.wipLimit).toBe(2);
    expect(next.columns.doing.wipLimit).toBe(3);
    expect(next.columns.done.wipLimit).toBeNull();
    expect(next.columns.todo.cards).toEqual(board.columns.todo.cards);
  });

  it('clears the limit with null', () => {
    expect(setWipLimit(board, 'doing', null).columns.doing.wipLimit).toBeNull();
  });

  it.each([0, -1, 1.5, NaN, Infinity])('refuses the limit %j', (limit) => {
    expect(() => setWipLimit(board, 'todo', limit)).toThrow(RangeError);
  });
});

describe('isOverLimit', () => {
  it('is false at the limit and true above it', () => {
    const atLimit = deepFreeze({
      ...emptyBoard(),
      columns: { ...emptyBoard().columns, todo: { wipLimit: 3, cards: [card('a'), card('b'), card('c')] } },
    });
    expect(isOverLimit(atLimit, 'todo')).toBe(false);
    expect(isOverLimit(addCard(atLimit, 'todo', card('d')), 'todo')).toBe(true);
  });

  it('is never true without a limit', () => {
    const noLimit = deepFreeze({
      ...emptyBoard(),
      columns: { ...emptyBoard().columns, todo: { wipLimit: null, cards: [card('a'), card('b'), card('c'), card('d')] } },
    });
    expect(isOverLimit(noLimit, 'todo')).toBe(false);
  });

  it('looks at the chosen column only', () => {
    const crowded = deepFreeze({
      ...emptyBoard(),
      columns: {
        ...emptyBoard().columns,
        todo: { wipLimit: 3, cards: [card('a'), card('b'), card('c'), card('d')] },
      },
    });
    expect(isOverLimit(crowded, 'todo')).toBe(true);
    expect(isOverLimit(crowded, 'doing')).toBe(false);
  });
});

describe('isValidDue', () => {
  it.each([null, '2026-01-01', '2024-02-29', '2000-02-29', '2026-12-31', '0024-02-29'])('accepts %j', (value) => {
    expect(isValidDue(value)).toBe(true);
  });

  it.each([
    '2026-02-29',
    '2026-02-30',
    '2100-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-2-3',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01\n',
    '20260101',
    '2026-01-01T00:00:00Z',
    '',
    'tomorrow',
    20260101,
    undefined,
    {},
  ])('rejects %j', (value) => {
    expect(isValidDue(value)).toBe(false);
  });
});

describe('isValidWipLimit', () => {
  it.each([null, 1, 3, 100])('accepts %j', (value) => {
    expect(isValidWipLimit(value)).toBe(true);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, '3', '', undefined, {}])('rejects %j', (value) => {
    expect(isValidWipLimit(value)).toBe(false);
  });
});
