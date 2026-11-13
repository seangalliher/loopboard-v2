export const COLUMNS = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
] as const;

export type ColumnId = (typeof COLUMNS)[number]['id'];

export type Card = { id: string; title: string; note: string; due: string | null };

export type Board = {
  version: 1;
  columns: Record<ColumnId, { wipLimit: number | null; cards: Card[] }>;
};

type Column = Board['columns'][ColumnId];

export function emptyBoard(): Board {
  return {
    version: 1,
    columns: {
      todo: { wipLimit: null, cards: [] },
      doing: { wipLimit: null, cards: [] },
      done: { wipLimit: null, cards: [] },
    },
  };
}

export function isValidDue(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // an impossible day such as 2026-02-30 rolls over into the next month, so the parts no longer match
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidWipLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function withColumn(board: Board, id: ColumnId, changes: Partial<Column>): Board {
  return { ...board, columns: { ...board.columns, [id]: { ...board.columns[id], ...changes } } };
}

function findCard(board: Board, id: string): { column: ColumnId; card: Card } | undefined {
  for (const { id: column } of COLUMNS) {
    const card = board.columns[column].cards.find((candidate) => candidate.id === id);
    if (card) return { column, card };
  }
  return undefined;
}

function checkedFields(fields: Omit<Card, 'id'>): Omit<Card, 'id'> {
  const title = fields.title.trim();
  if (title === '') throw new RangeError('A card needs a title.');
  if (!isValidDue(fields.due)) throw new RangeError('The due date must be empty or a real date written YYYY-MM-DD.');
  return { title, note: fields.note.trim(), due: fields.due };
}

export function addCard(board: Board, column: ColumnId, card: Card): Board {
  const fields = checkedFields(card);
  return withColumn(board, column, { cards: [...board.columns[column].cards, { id: card.id, ...fields }] });
}

export function editCard(board: Board, id: string, fields: Omit<Card, 'id'>): Board {
  const checked = checkedFields(fields);
  const found = findCard(board, id);
  if (!found) return board;
  return withColumn(board, found.column, {
    cards: board.columns[found.column].cards.map((card) => (card.id === id ? { id: card.id, ...checked } : card)),
  });
}

export function deleteCard(board: Board, id: string): Board {
  const found = findCard(board, id);
  if (!found) return board;
  return withColumn(board, found.column, {
    cards: board.columns[found.column].cards.filter((card) => card.id !== id),
  });
}

export function moveCard(board: Board, id: string, to: ColumnId): Board {
  const found = findCard(board, id);
  if (!found || found.column === to) return board;
  const without = deleteCard(board, id);
  return withColumn(without, to, { cards: [...without.columns[to].cards, found.card] });
}

export function setWipLimit(board: Board, column: ColumnId, limit: number | null): Board {
  if (!isValidWipLimit(limit)) {
    throw new RangeError('The WIP limit must be a whole number of at least 1, or empty for no limit.');
  }
  return withColumn(board, column, { wipLimit: limit });
}

export function isOverLimit(board: Board, column: ColumnId): boolean {
  const { wipLimit, cards } = board.columns[column];
  return wipLimit !== null && cards.length > wipLimit;
}
