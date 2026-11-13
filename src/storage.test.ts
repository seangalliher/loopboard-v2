import { describe, expect, it } from 'vitest';
import { addCard, emptyBoard, setWipLimit, type Board } from './board';
import { loadBoard, parseBoard, saveBoard, serializeBoard } from './storage';

const KEY = 'loopboard:board'; // written out on purpose: the test must not import the constant under test

// In-memory stand-in for localStorage; getItem returns null for a missing key, like the real one.
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
  };
}

const sample: Board = {
  version: 1,
  columns: {
    todo: {
      wipLimit: 2,
      cards: [
        { id: 'a', title: 'Write docs', note: 'two\nlines', due: '2026-03-01' },
        { id: 'b', title: 'Plan', note: '', due: null },
      ],
    },
    doing: { wipLimit: null, cards: [{ id: 'c', title: 'Build', note: 'x', due: '2024-02-29' }] },
    done: { wipLimit: 5, cards: [{ id: 'd', title: 'Ship', note: '', due: null }] },
  },
};

const sampleText =
  '{"version":1,"columns":{"todo":{"wipLimit":2,"cards":[' +
  '{"id":"a","title":"Write docs","note":"two\\nlines","due":"2026-03-01"},' +
  '{"id":"b","title":"Plan","note":"","due":null}]},' +
  '"doing":{"wipLimit":null,"cards":[{"id":"c","title":"Build","note":"x","due":"2024-02-29"}]},' +
  '"done":{"wipLimit":5,"cards":[{"id":"d","title":"Ship","note":"","due":null}]}}}';

// Builders for JSON text. A property given as `undefined` is left out of the text (JSON.stringify skips it).
const card = (fields: Record<string, unknown> = {}) => ({ id: 'a', title: 'T', note: '', due: null, ...fields });
const column = (fields: Record<string, unknown> = {}) => ({ wipLimit: null, cards: [], ...fields });
const file = (top: Record<string, unknown> = {}, columns: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, columns: { todo: column(), doing: column(), done: column(), ...columns }, ...top });
const todoWith = (...cards: unknown[]) => file({}, { todo: column({ cards }) });

describe('serializeBoard and parseBoard: format and round trip', () => {
  it('writes the documented JSON, fields in this order', () => {
    expect(serializeBoard(emptyBoard())).toBe(
      '{"version":1,"columns":{"todo":{"wipLimit":null,"cards":[]},"doing":{"wipLimit":null,"cards":[]},"done":{"wipLimit":null,"cards":[]}}}',
    );
    expect(serializeBoard(sample)).toBe(sampleText);
  });

  it('round-trips with cards in every column, notes, dues, limits set and unset', () => {
    expect(parseBoard(serializeBoard(sample))).toEqual(sample);
    expect(parseBoard(serializeBoard(emptyBoard()))).toEqual(emptyBoard());
  });

  it('writes a board built with the board functions in the same field order', () => {
    const board = setWipLimit(addCard(emptyBoard(), 'doing', { id: 'c', title: ' Build ', note: '', due: null }), 'doing', 3);
    expect(serializeBoard(board)).toBe(
      '{"version":1,"columns":{"todo":{"wipLimit":null,"cards":[]},"doing":{"wipLimit":3,"cards":[{"id":"c","title":"Build","note":"","due":null}]},"done":{"wipLimit":null,"cards":[]}}}',
    );
  });

  it('export, import, export gives the same text', () => {
    const text = serializeBoard(sample);
    expect(serializeBoard(parseBoard(text))).toBe(text);
  });

  it('builds the board field by field, so the key order of the file does not leak', () => {
    const text =
      '{"columns":{"done":{"cards":[],"wipLimit":null},"doing":{"cards":[{"due":null,"note":"","title":"T","id":"a"}],"wipLimit":3},"todo":{"cards":[],"wipLimit":null}},"version":1}';
    expect(serializeBoard(parseBoard(text))).toBe(
      '{"version":1,"columns":{"todo":{"wipLimit":null,"cards":[]},"doing":{"wipLimit":3,"cards":[{"id":"a","title":"T","note":"","due":null}]},"done":{"wipLimit":null,"cards":[]}}}',
    );
  });
});

describe('parseBoard rejects', () => {
  it('accepts the smallest valid file', () => {
    expect(parseBoard(file())).toEqual(emptyBoard());
    expect(parseBoard(todoWith(card()))).toEqual({
      ...emptyBoard(),
      columns: { ...emptyBoard().columns, todo: { wipLimit: null, cards: [card()] } },
    });
  });

  it('text that is not JSON', () => {
    expect(() => parseBoard('not json')).toThrow('The file is not valid JSON.');
  });

  it.each(['[]', 'null', '5', '"text"', 'true'])('a file that is not an object: %s', (text) => {
    expect(() => parseBoard(text)).toThrow('The file must be an object.');
  });

  it.each([
    ['missing', undefined],
    ['2', 2],
    ['the text "1"', '1'],
  ])('a version that is not 1: %s', (_name, version) => {
    expect(() => parseBoard(file({ version }))).toThrow('version must be 1.');
  });

  it('columns that is not an object', () => {
    expect(() => parseBoard(file({ columns: [] }))).toThrow('columns must be an object.');
  });

  it('a missing column', () => {
    expect(() => parseBoard(file({}, { doing: undefined }))).toThrow('columns.doing is missing.');
  });

  it('a column that is not an object', () => {
    expect(() => parseBoard(file({}, { done: 5 }))).toThrow('columns.done must be an object.');
  });

  it('an unknown column', () => {
    expect(() => parseBoard(file({}, { archive: column() }))).toThrow('Unexpected property "archive" in columns.');
  });

  it.each([
    ['missing', undefined],
    ['an object', {}],
    ['text', 'nope'],
  ])('cards that is not an array: %s', (_name, cards) => {
    expect(() => parseBoard(file({}, { doing: column({ cards }) }))).toThrow('columns.doing.cards must be an array.');
  });

  it.each([
    ['a number', 5],
    ['null', null],
    ['an array', []],
    ['text', 'text'],
  ])('a card that is not an object: %s', (_name, value) => {
    expect(() => parseBoard(todoWith(card(), value))).toThrow('columns.todo.cards[1] must be an object.');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a number', 5],
  ])('a card id that is not a non-empty string: %s', (_name, id) => {
    expect(() => parseBoard(todoWith(card({ id })))).toThrow('columns.todo.cards[0].id must be a non-empty string.');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a number', 5],
  ])('a card title that is not a non-empty string: %s', (_name, title) => {
    expect(() => parseBoard(todoWith(card({ title })))).toThrow('columns.todo.cards[0].title must be a non-empty string.');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 5],
  ])('a card note that is not a string: %s', (_name, note) => {
    expect(() => parseBoard(todoWith(card({ note })))).toThrow('columns.todo.cards[0].note must be a string.');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['2026-02-30', '2026-02-30'],
    ['2026-2-3', '2026-2-3'],
    ['a number', 20260101],
  ])('a card due that is not null or a real date: %s', (_name, due) => {
    expect(() => parseBoard(todoWith(card({ due })))).toThrow(
      'columns.todo.cards[0].due must be null or a real date written YYYY-MM-DD.',
    );
  });

  it('duplicate card ids across the board', () => {
    const text = file(
      {},
      { todo: column({ cards: [card({ id: 'x' })] }), done: column({ cards: [card({ id: 'x' })] }) },
    );
    expect(() => parseBoard(text)).toThrow('Card id "x" is used more than once (again at columns.done.cards[0].id).');
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['the text "3"', '3'],
    ['missing', undefined],
  ])('a WIP limit that is not null or a whole number of at least 1: %s', (_name, wipLimit) => {
    expect(() => parseBoard(file({}, { doing: column({ wipLimit }) }))).toThrow(
      'columns.doing.wipLimit must be null or a whole number of at least 1.',
    );
  });
});

describe('parseBoard rejects unexpected properties by name', () => {
  it('in the file', () => {
    expect(() => parseBoard(file({ extra: 1 }))).toThrow('Unexpected property "extra" in the file.');
  });

  it('in a column', () => {
    expect(() => parseBoard(file({}, { done: column({ extra: 1 }) }))).toThrow(
      'Unexpected property "extra" in columns.done.',
    );
  });

  it('in a card', () => {
    expect(() => parseBoard(todoWith(card({ extra: 1 })))).toThrow(
      'Unexpected property "extra" in columns.todo.cards[0].',
    );
  });

  it('named constructor, in a card', () => {
    expect(() => parseBoard(todoWith(card({ constructor: { prototype: { polluted: true } } })))).toThrow(
      'Unexpected property "constructor" in columns.todo.cards[0].',
    );
  });

  it.each([
    ['in the file', file().replace('{', '{"__proto__":{"polluted":true},'), 'the file'],
    ['in a card', todoWith(card()).replace('"id":"a"', '"__proto__":{"polluted":true},"id":"a"'), 'columns.todo.cards[0]'],
  ])('named __proto__, %s, and Object.prototype stays unchanged', (_name, text, where) => {
    try {
      expect(() => parseBoard(text)).toThrow(`Unexpected property "__proto__" in ${where}.`);
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
      expect('polluted' in {}).toBe(false);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'polluted'); // a failing guard must not poison the other tests
    }
  });
});

describe('loadBoard', () => {
  it('a missing key returns an empty board', () => {
    expect(loadBoard(fakeStorage())).toEqual(emptyBoard());
    expect(loadBoard(fakeStorage({ other: serializeBoard(sample) }))).toEqual(emptyBoard());
  });

  it.each(['not json', '{}', '{"version":2,"columns":{}}'])(
    'unreadable text returns an empty board, without throwing: %s',
    (text) => {
      expect(loadBoard(fakeStorage({ [KEY]: text }))).toEqual(emptyBoard());
    },
  );

  it('returns the stored board', () => {
    expect(loadBoard(fakeStorage({ [KEY]: serializeBoard(sample) }))).toEqual(sample);
  });
});

describe('saveBoard', () => {
  it('writes serializeBoard(board) under loopboard:board and nothing else', () => {
    const storage = fakeStorage();
    saveBoard(storage, sample);
    expect([...storage.data]).toEqual([[KEY, serializeBoard(sample)]]);
  });

  it('what is saved is loaded back', () => {
    const storage = fakeStorage();
    saveBoard(storage, sample);
    expect(loadBoard(storage)).toEqual(sample);
  });

  it('lets a throwing setItem propagate', () => {
    const quota = new Error('quota exceeded');
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw quota;
      },
    };
    expect(() => saveBoard(storage, sample)).toThrow(quota);
  });
});
