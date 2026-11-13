import { COLUMNS, emptyBoard, isValidDue, isValidWipLimit, type Board, type Card, type ColumnId } from './board';

const STORAGE_KEY = 'loopboard:board';

type BoardStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Column = Board['columns'][ColumnId];
type Json = Record<string, unknown>;

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object.`);
  }
  return value as Json;
}

// JSON.parse makes a "__proto__" key an ordinary own property, so Object.keys lists it and it is rejected like any other name.
function rejectUnexpected(object: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new Error(`Unexpected property "${key}" in ${where}.`);
  }
}

function parseCard(raw: unknown, path: string, seenIds: Set<string>): Card {
  const card = asObject(raw, path);
  rejectUnexpected(card, ['id', 'title', 'note', 'due'], path);
  const { id, title, note, due } = card;
  if (typeof id !== 'string' || id === '') throw new Error(`${path}.id must be a non-empty string.`);
  if (typeof title !== 'string' || title === '') throw new Error(`${path}.title must be a non-empty string.`);
  if (typeof note !== 'string') throw new Error(`${path}.note must be a string.`);
  if (!isValidDue(due)) throw new Error(`${path}.due must be null or a real date written YYYY-MM-DD.`);
  if (seenIds.has(id)) throw new Error(`Card id "${id}" is used more than once (again at ${path}.id).`);
  seenIds.add(id);
  return { id, title, note, due };
}

function parseColumn(raw: unknown, path: string, seenIds: Set<string>): Column {
  const column = asObject(raw, path);
  rejectUnexpected(column, ['wipLimit', 'cards'], path);
  const { wipLimit, cards } = column;
  if (!isValidWipLimit(wipLimit)) throw new Error(`${path}.wipLimit must be null or a whole number of at least 1.`);
  if (!Array.isArray(cards)) throw new Error(`${path}.cards must be an array.`);
  return { wipLimit, cards: cards.map((card, index) => parseCard(card, `${path}.cards[${index}]`, seenIds)) };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board);
}

export function parseBoard(text: string): Board {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const root = asObject(data, 'The file');
  if (root.version !== 1) throw new Error('version must be 1.');
  rejectUnexpected(root, ['version', 'columns'], 'the file');
  const columns = asObject(root.columns, 'columns');
  for (const { id } of COLUMNS) {
    if (!Object.hasOwn(columns, id)) throw new Error(`columns.${id} is missing.`);
  }
  rejectUnexpected(columns, COLUMNS.map((column) => column.id), 'columns');
  const seenIds = new Set<string>();
  return {
    version: 1,
    columns: {
      todo: parseColumn(columns.todo, 'columns.todo', seenIds),
      doing: parseColumn(columns.doing, 'columns.doing', seenIds),
      done: parseColumn(columns.done, 'columns.done', seenIds),
    },
  };
}

export function loadBoard(storage: BoardStorage): Board {
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return emptyBoard();
  try {
    return parseBoard(text);
  } catch {
    return emptyBoard();
  }
}

export function saveBoard(storage: BoardStorage, board: Board): void {
  storage.setItem(STORAGE_KEY, serializeBoard(board));
}
