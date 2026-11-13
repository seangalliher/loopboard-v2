// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { addCard, emptyBoard, type Card, type ColumnId } from '../board';
import { parseBoard, serializeBoard } from '../storage';
import { mountApp } from './app';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'loopboard:board';
const SAVE_FAILED = 'The board could not be saved. Your changes may be lost when you reload.';
const LOAD_FAILED = 'The saved board could not be read, so the board starts empty.';
const BLANK_TITLE = 'A card needs a title.';
const BAD_DUE = 'The due date must be empty or a real date written YYYY-MM-DD.';
const COLUMN_IDS = ['todo', 'doing', 'done'] as const;

let root: HTMLElement;
let counter: number;

function start(storage: Store = localStorage): void {
  mountApp(root, { storage, newId: () => `id-${++counter}` });
}

// a storage that works like localStorage except where a test replaces one method
function storageWith(replace: Partial<Store>): Store {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    ...replace,
  };
}

function seed(): void {
  let board = emptyBoard();
  const cards: [ColumnId, Card][] = [
    ['todo', { id: 'a', title: 'Buy milk', note: '2 litres', due: '2026-11-20' }],
    ['todo', { id: 'b', title: 'Write report', note: '', due: null }],
    ['doing', { id: 'c', title: 'Fix bike', note: '', due: null }],
    ['done', { id: 'd', title: 'Pay rent', note: 'Paid online', due: '2026-11-01' }],
  ];
  for (const [column, card] of cards) board = addCard(board, column, card);
  localStorage.setItem(KEY, serializeBoard(board));
  start();
}

function column(id: ColumnId): HTMLElement {
  const found = root.querySelector<HTMLElement>(`section[data-column="${id}"]`);
  if (!found) throw new Error(`no ${id} column`);
  return found;
}

function button(name: string): HTMLButtonElement {
  const matches = [...root.querySelectorAll('button')].filter((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === name);
  expect(matches, `buttons named ${name}`).toHaveLength(1);
  return matches[0];
}

function field(within: ParentNode, label: string): HTMLInputElement | HTMLTextAreaElement {
  const control = [...within.querySelectorAll('label')].find((candidate) => candidate.textContent === label)?.control;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`no field labelled ${label}`);
  return control;
}

function addForm(): HTMLFormElement {
  const form = column('todo').querySelector<HTMLFormElement>('form.add-form');
  if (!form) throw new Error('no add form');
  return form;
}

function editForm(): HTMLFormElement {
  const form = root.querySelector<HTMLFormElement>('form.edit-form');
  if (!form) throw new Error('no edit form');
  return form;
}

function fillAdd(values: { title?: string; note?: string; due?: string }): void {
  field(addForm(), 'Title').value = values.title ?? '';
  field(addForm(), 'Note').value = values.note ?? '';
  field(addForm(), 'Due date').value = values.due ?? '';
}

function add(title: string, note = '', due = ''): void {
  fillAdd({ title, note, due });
  button('Add card').click();
}

function cardsIn(id: ColumnId): { title: string; note: string; due: string }[] {
  return [...column(id).querySelectorAll('li')].map((item) => ({
    title: item.querySelector('h3')?.textContent ?? '',
    note: item.querySelector('.card-note')?.textContent ?? '',
    due: item.querySelector('.card-due')?.textContent ?? '',
  }));
}

function everything() {
  return { todo: cardsIn('todo'), doing: cardsIn('doing'), done: cardsIn('done') };
}

function storedCards(id: ColumnId): Card[] {
  return parseBoard(localStorage.getItem(KEY) ?? '').columns[id].cards;
}

function alerts(): Element[] {
  return [...root.querySelectorAll('[role="alert"]')];
}

function rename(from: string, to: string): void {
  button(`Edit "${from}"`).click();
  field(editForm(), 'Title').value = to;
  button('Save').click();
}

// Two tabs of one browser share one localStorage. The second tab is another root over the same storage; the helpers act on
// `root`, so point `root` at a tab to act in it.
function openSecondTab(): HTMLElement {
  const first = root;
  const second = document.createElement('div');
  document.body.append(second);
  root = second;
  start();
  root = first;
  return second;
}

function titlesByColumn(read: (id: ColumnId) => { title: string }[]) {
  return { todo: read('todo').map((card) => card.title), doing: read('doing').map((card) => card.title), done: read('done').map((card) => card.title) };
}

beforeEach(() => {
  localStorage.clear();
  counter = 0;
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('start-up and layout', () => {
  it('renders an h1 and three sections in order, each named by its h2 and holding a card list and a count', () => {
    start();
    const heading = root.querySelector('h1');
    expect(heading?.textContent).toBe('LoopBoard');
    const sections = [...root.querySelectorAll('section')];
    expect(sections).toHaveLength(3);
    const names = sections.map((section) => document.getElementById(section.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(names).toEqual(['To do', 'Doing', 'Done']);
    for (const section of sections) {
      expect(section.querySelector('h2')?.id).toBe(section.getAttribute('aria-labelledby'));
      expect(section.querySelector('ul')).not.toBeNull();
      expect(section.querySelector('.count')?.textContent).toBe('0 cards');
      expect(heading && heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(root.querySelectorAll('form')).toHaveLength(1);
    expect(column('todo').contains(addForm())).toBe(true);
  });

  it('shows the stored board in its columns with notes, due dates and counts', () => {
    seed();
    expect(everything()).toEqual({
      todo: [
        { title: 'Buy milk', note: '2 litres', due: 'Due 2026-11-20' },
        { title: 'Write report', note: '', due: '' },
      ],
      doing: [{ title: 'Fix bike', note: '', due: '' }],
      done: [{ title: 'Pay rent', note: 'Paid online', due: 'Due 2026-11-01' }],
    });
    expect(COLUMN_IDS.map((id) => column(id).querySelector('.count')?.textContent)).toEqual(['2 cards', '1 card', '1 card']);
  });

  it('has one role="alert" element, empty while nothing is wrong', () => {
    start();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toBe('');
  });
});

describe('add', () => {
  it('appends a card with title, note and due date to To do and saves it', () => {
    seed();
    add('  Call Ann  ', 'About the trip', '2026-12-24');
    expect(cardsIn('todo')[2]).toEqual({ title: 'Call Ann', note: 'About the trip', due: 'Due 2026-12-24' });
    expect(cardsIn('doing')).toHaveLength(1);
    expect(cardsIn('done')).toHaveLength(1);
    expect(column('todo').querySelector('.count')?.textContent).toBe('3 cards');
    expect(storedCards('todo')[2]).toEqual({ id: 'id-1', title: 'Call Ann', note: 'About the trip', due: '2026-12-24' });
  });

  it('stores an empty due date as null', () => {
    start();
    add('No date');
    expect(cardsIn('todo')).toEqual([{ title: 'No date', note: '', due: '' }]);
    expect(storedCards('todo')[0].due).toBeNull();
  });

  it('clears the form and puts focus back on the Title field', () => {
    start();
    fillAdd({ title: 'Buy milk', note: 'x', due: '2026-11-20' });
    button('Add card').focus();
    button('Add card').click();
    expect(field(addForm(), 'Title').value).toBe('');
    expect(field(addForm(), 'Note').value).toBe('');
    expect(field(addForm(), 'Due date').value).toBe('');
    expect(document.activeElement).toBe(field(addForm(), 'Title'));
  });

  it.each(['', '   '])('a blank title (%j) adds nothing, says why and leaves focus alone', (title) => {
    start();
    field(addForm(), 'Title').focus();
    add(title, 'a note');
    expect(cardsIn('todo')).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(addForm().querySelector('.form-error')?.textContent).toBe(BLANK_TITLE);
    expect(field(addForm(), 'Note').value).toBe('a note');
    expect(document.activeElement).toBe(field(addForm(), 'Title'));
  });

  it('a due date the board rejects (a six-digit year) adds nothing and says why', () => {
    start();
    add('Far future', '', '12345-01-01');
    expect(cardsIn('todo')).toEqual([]);
    expect(addForm().querySelector('.form-error')?.textContent).toBe(BAD_DUE);
  });

  it('a good add after a refused one removes the message', () => {
    start();
    add('');
    add('Now it works');
    expect(addForm().querySelector('.form-error')?.textContent).toBe('');
    expect(cardsIn('todo')).toHaveLength(1);
  });

  it('keeps what is typed in the add form when another change redraws the lists', () => {
    seed();
    fillAdd({ title: 'Half typed', note: 'still here' });
    button('Delete "Fix bike"').click();
    expect(field(addForm(), 'Title').value).toBe('Half typed');
    expect(field(addForm(), 'Note').value).toBe('still here');
  });
});

describe('edit', () => {
  it('swaps the card for a form holding its values, with Save and Cancel, and focuses Title', () => {
    seed();
    button('Edit "Buy milk"').click();
    const form = editForm();
    expect(field(form, 'Title').value).toBe('Buy milk');
    expect(field(form, 'Note').value).toBe('2 litres');
    expect(field(form, 'Due date').value).toBe('2026-11-20');
    expect([...form.querySelectorAll('button')].map((control) => control.textContent)).toEqual(['Save', 'Cancel']);
    expect(column('todo').querySelectorAll('li')).toHaveLength(2);
    expect(column('todo').contains(form)).toBe(true);
    expect(root.querySelectorAll('button[aria-label="Edit \\"Buy milk\\""]')).toHaveLength(0);
    expect(document.activeElement).toBe(field(form, 'Title'));
  });

  it('Save updates only that card and saves it, then focuses that card\'s Edit button', () => {
    seed();
    button('Edit "Buy milk"').click();
    field(editForm(), 'Title').value = '  Buy oat milk ';
    field(editForm(), 'Note').value = '';
    field(editForm(), 'Due date').value = '';
    button('Save').click();
    expect(root.querySelector('form.edit-form')).toBeNull();
    expect(cardsIn('todo')).toEqual([
      { title: 'Buy oat milk', note: '', due: '' },
      { title: 'Write report', note: '', due: '' },
    ]);
    expect(storedCards('todo')).toEqual([
      { id: 'a', title: 'Buy oat milk', note: '', due: null },
      { id: 'b', title: 'Write report', note: '', due: null },
    ]);
    expect(document.activeElement).toBe(button('Edit "Buy oat milk"'));
  });

  it('Cancel restores the card, saves nothing and focuses that card\'s Edit button', () => {
    seed();
    const before = localStorage.getItem(KEY);
    button('Edit "Buy milk"').click();
    field(editForm(), 'Title').value = 'Changed';
    button('Cancel').click();
    expect(root.querySelector('form.edit-form')).toBeNull();
    expect(cardsIn('todo')[0]).toEqual({ title: 'Buy milk', note: '2 litres', due: 'Due 2026-11-20' });
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(document.activeElement).toBe(button('Edit "Buy milk"'));
  });

  it('a blank title is refused with a message; the form stays open and nothing is saved', () => {
    seed();
    const before = localStorage.getItem(KEY);
    button('Edit "Buy milk"').click();
    field(editForm(), 'Title').value = '  ';
    field(editForm(), 'Note').value = 'kept';
    button('Save').click();
    expect(editForm().querySelector('.form-error')?.textContent).toBe(BLANK_TITLE);
    expect(field(editForm(), 'Note').value).toBe('kept');
    expect(localStorage.getItem(KEY)).toBe(before);
    field(editForm(), 'Title').value = 'Fixed';
    button('Save').click();
    expect(cardsIn('todo')[0].title).toBe('Fixed');
    expect(root.querySelector('form.edit-form')).toBeNull();
  });

  it('only one card is edited at a time', () => {
    seed();
    button('Edit "Buy milk"').click();
    button('Edit "Write report"').click();
    expect(root.querySelectorAll('form.edit-form')).toHaveLength(1);
    expect(field(editForm(), 'Title').value).toBe('Write report');
    expect(button('Edit "Buy milk"')).toBeTruthy();
  });
});

describe('delete', () => {
  it('removes the card at once and saves', () => {
    seed();
    button('Delete "Buy milk"').click();
    expect(cardsIn('todo').map((card) => card.title)).toEqual(['Write report']);
    expect(column('todo').querySelector('.count')?.textContent).toBe('1 card');
    expect(storedCards('todo').map((card) => card.id)).toEqual(['b']);
  });

  it.each([
    ['todo', 'Buy milk', 'To do'],
    ['doing', 'Fix bike', 'Doing'],
    ['done', 'Pay rent', 'Done'],
  ] as const)('focus lands on the heading of %s, which has tabindex -1, not on <body>', (id, title, heading) => {
    seed();
    button(`Delete "${title}"`).click();
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(focused?.tagName).toBe('H2');
    expect(focused?.textContent).toBe(heading);
    expect(focused?.getAttribute('tabindex')).toBe('-1');
    expect(column(id).contains(focused)).toBe(true);
  });
});

describe('saving and loading', () => {
  it('calls saveBoard once per change: add, Save and Delete, but not for Cancel or a refused form', () => {
    seed();
    const saved: string[] = [];
    start(storageWith({ setItem: (key, value) => { saved.push(value); localStorage.setItem(key, value); } }));
    add('New');
    expect(saved).toHaveLength(1);
    add('');
    button('Edit "New"').click();
    button('Cancel').click();
    expect(saved).toHaveLength(1);
    button('Edit "New"').click();
    button('Save').click();
    expect(saved).toHaveLength(2);
    button('Delete "New"').click();
    expect(saved).toHaveLength(3);
    expect(saved[2]).toBe(localStorage.getItem(KEY));
  });

  it('running the start-up again against the same storage shows the same board', () => {
    start();
    add('Buy milk', '2 litres', '2026-11-20');
    add('Write report');
    add('Throw away');
    button('Edit "Write report"').click();
    field(editForm(), 'Note').value = 'Due soon';
    button('Save').click();
    button('Delete "Throw away"').click();
    const before = everything();
    expect(before.todo).toHaveLength(2);
    root.replaceChildren();
    start();
    expect(everything()).toEqual(before);
    expect(storedCards('todo').map((card) => card.id)).toEqual(['id-1', 'id-2']);
  });

  it('when saving throws, one role="alert" says so and the change stays on screen', () => {
    start(storageWith({ setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }));
    add('Unsaved');
    add('Also unsaved');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toBe(SAVE_FAILED);
    expect(alerts()[0].hasAttribute('hidden')).toBe(false);
    expect(cardsIn('todo').map((card) => card.title)).toEqual(['Unsaved', 'Also unsaved']);
  });

  it('the alert goes away after a save works again', () => {
    let broken = true;
    start(storageWith({ setItem: (key, value) => { if (broken) throw new Error('blocked'); localStorage.setItem(key, value); } }));
    add('First');
    expect(alerts()[0].textContent).toBe(SAVE_FAILED);
    broken = false;
    add('Second');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toBe('');
  });

  it('when loading throws, starts with an empty board and shows the alert; later changes are still saved', () => {
    const saved: string[] = [];
    start(storageWith({
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: (key, value) => { saved.push(value); localStorage.setItem(key, value); },
    }));
    expect(everything()).toEqual({ todo: [], doing: [], done: [] });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toBe(LOAD_FAILED);
    add('After the failure');
    expect(saved).toHaveLength(1);
    expect(alerts()[0].textContent).toBe('');
  });
});

describe('two tabs on one storage', () => {
  // Tab A saves three changes; tab B, opened before them, still shows the old board. Leaves `root` on tab B.
  function staleTab(): void {
    seed();
    const tabB = openSecondTab();
    add('From A');
    button('Delete "Write report"').click();
    rename('Fix bike', 'Fix bike (A)');
    expect(titlesByColumn(storedCards)).toEqual({ todo: ['Buy milk', 'From A'], doing: ['Fix bike (A)'], done: ['Pay rent'] });
    root = tabB;
    expect(titlesByColumn(cardsIn)).toEqual({ todo: ['Buy milk', 'Write report'], doing: ['Fix bike'], done: ['Pay rent'] });
  }

  it.each([
    ['adds a card', () => add('From B'), { todo: ['Buy milk', 'From A', 'From B'], doing: ['Fix bike (A)'], done: ['Pay rent'] }],
    ['saves an edit of another card', () => rename('Buy milk', 'Buy oat milk'), { todo: ['Buy oat milk', 'From A'], doing: ['Fix bike (A)'], done: ['Pay rent'] }],
    ['saves an edit of the same card (the last save wins)', () => rename('Fix bike', 'Fix bike (B)'), { todo: ['Buy milk', 'From A'], doing: ['Fix bike (B)'], done: ['Pay rent'] }],
    ['saves an edit of a card the other tab deleted (it stays deleted)', () => rename('Write report', 'Report v2'), { todo: ['Buy milk', 'From A'], doing: ['Fix bike (A)'], done: ['Pay rent'] }],
    ['deletes another card', () => button('Delete "Pay rent"').click(), { todo: ['Buy milk', 'From A'], doing: ['Fix bike (A)'], done: [] }],
    ['deletes a card the other tab deleted', () => button('Delete "Write report"').click(), { todo: ['Buy milk', 'From A'], doing: ['Fix bike (A)'], done: ['Pay rent'] }],
  ] as const)('a stale tab that %s keeps what the other tab saved', (_what, act, expected) => {
    staleTab();
    act();
    expect(titlesByColumn(storedCards)).toEqual(expected);
    expect(titlesByColumn(cardsIn)).toEqual(expected);
    expect(alerts()[0].textContent).toBe('');
  });

  it('when storage cannot be read after start-up, builds the change on the board on screen', () => {
    let readable = true;
    seed();
    start(storageWith({ getItem: (key) => { if (!readable) throw new DOMException('blocked', 'SecurityError'); return localStorage.getItem(key); } }));
    readable = false;
    add('New');
    expect(titlesByColumn(storedCards).todo).toEqual(['Buy milk', 'Write report', 'New']);
    expect(titlesByColumn(cardsIn).todo).toEqual(['Buy milk', 'Write report', 'New']);
    expect(alerts()[0].textContent).toBe('');
  });

  it('after a failed save, builds on the board on screen until a save works again, then on storage', () => {
    let broken = true;
    start(storageWith({ setItem: (key, value) => { if (broken) throw new Error('blocked'); localStorage.setItem(key, value); } }));
    const tabA = root;
    const tabB = openSecondTab();
    add('First'); // not saved
    broken = false;
    add('Second'); // saved together with First
    expect(titlesByColumn(storedCards).todo).toEqual(['First', 'Second']);
    root = tabB;
    add('From B');
    root = tabA;
    add('Third'); // storage is trusted again, so From B is kept
    expect(titlesByColumn(storedCards).todo).toEqual(['First', 'Second', 'From B', 'Third']);
  });
});

describe('titles with line breaks', () => {
  // A stored title may hold line breaks (a board imported from a file); a single-line input drops some of them from what it shows.
  const TITLES = ['Quoted "title"\nand second line', 'one\r\ntwo', 'one\rtwo', 'one\u2028two', 'one\ttwo'];

  function openEditor(title: string): void {
    localStorage.setItem(KEY, serializeBoard(addCard(emptyBoard(), 'todo', { id: 'a', title, note: 'a note', due: null })));
    start();
    button(`Edit "${title}"`).click();
  }

  it.each(TITLES)('Save without touching the title keeps %j exactly', (title) => {
    openEditor(title);
    button('Save').click();
    expect(storedCards('todo')).toEqual([{ id: 'a', title, note: 'a note', due: null }]);
    expect(cardsIn('todo')[0].title).toBe(title);
  });

  it('Save after changing only the note keeps the title', () => {
    openEditor(TITLES[0]);
    field(editForm(), 'Note').value = 'changed';
    button('Save').click();
    expect(storedCards('todo')).toEqual([{ id: 'a', title: TITLES[0], note: 'changed', due: null }]);
  });

  it('Save after typing a new title stores what was typed', () => {
    openEditor(TITLES[0]);
    field(editForm(), 'Title').value = 'Replaced';
    button('Save').click();
    expect(storedCards('todo')[0].title).toBe('Replaced');
  });
});

describe('untrusted text', () => {
  it('a title of <img src=x onerror=alert(1)> renders as text and creates no <img>', () => {
    const evil = '<img src=x onerror=alert(1)>';
    start();
    add(evil, '<b>bold</b>');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(cardsIn('todo')).toEqual([{ title: evil, note: '<b>bold</b>', due: '' }]);
    expect(root.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    button(`Edit "${evil}"`).click();
    expect(field(editForm(), 'Title').value).toBe(evil);
    expect(root.querySelector('img')).toBeNull();
    button('Cancel').click();
    root.replaceChildren();
    start();
    expect(root.querySelector('img')).toBeNull();
    expect(cardsIn('todo')[0].title).toBe(evil);
  });
});

describe('main.ts', () => {
  it('starts the app in #app from localStorage and gives new cards UUID ids', async () => {
    localStorage.setItem(KEY, serializeBoard(addCard(emptyBoard(), 'doing', { id: 'x', title: 'Already here', note: '', due: null })));
    root = document.createElement('div');
    root.id = 'app';
    document.body.replaceChildren(root);
    await import('../main');
    expect(root.querySelector('h1')?.textContent).toBe('LoopBoard');
    expect(cardsIn('doing').map((card) => card.title)).toEqual(['Already here']);
    add('From main');
    const [stored] = storedCards('todo');
    expect(stored.title).toBe('From main');
    expect(stored.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
