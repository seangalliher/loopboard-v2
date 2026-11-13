// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const CARD_TYPE = 'application/x-loopboard-card';

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
  button(`Save "${from}"`).click();
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

// jsdom has neither DragEvent nor DataTransfer. A drag event here is a MouseEvent (it carries relatedTarget) with a stub dataTransfer.
function transferOf(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? '',
  };
}

function fire(target: Element, type: string, transfer: object, relatedTarget: Element | null = null): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
  return event;
}

function cardItem(title: string): HTMLLIElement {
  const found = [...root.querySelectorAll<HTMLLIElement>('li.card')].find((item) => item.querySelector('h3')?.textContent === title);
  if (!found) throw new Error(`no card titled ${title}`);
  return found;
}

// `selector` '' is the column's section itself; anything else is an element inside it.
function within(id: ColumnId, selector: string): Element {
  const found = selector === '' ? column(id) : column(id).querySelector(selector);
  if (!found) throw new Error(`nothing matches "${selector}" in ${id}`);
  return found;
}

// A whole drag: the card is picked up, held over `target`, dropped there, and the drag ends on the card that was picked up.
function drag(title: string, target: Element): void {
  const source = cardItem(title);
  const transfer = transferOf();
  fire(source, 'dragstart', transfer);
  fire(target, 'dragenter', transfer);
  fire(target, 'dragover', transfer);
  fire(target, 'drop', transfer);
  fire(source, 'dragend', transfer);
}

function status(): HTMLElement {
  const found = root.querySelector<HTMLElement>('.move-status');
  if (!found) throw new Error('no move status');
  return found;
}

function marked(): boolean[] {
  return COLUMN_IDS.map((id) => column(id).classList.contains('drop-target'));
}

function wip(id: ColumnId): HTMLInputElement {
  const found = column(id).querySelector<HTMLInputElement>('input.wip-input');
  if (!found) throw new Error(`no WIP limit box in ${id}`);
  return found;
}

// What a browser does when a limit is typed and the box is left, or Enter is pressed: the text is in the box, then `change` fires.
function typeLimit(id: ColumnId, text: string): void {
  wip(id).value = text;
  wip(id).dispatchEvent(new Event('change', { bubbles: true }));
}

// What Chromium does when a person edits the box (measured): `beforeinput` first, which an app can cancel. If nothing cancels it, the
// browser changes the box to `result` and then fires `input`. A number box drops the text it cannot show but still deletes the
// selected number that text replaced, so `result` is '' for letters typed over it. Returns false when the edit was cancelled.
function editLimit(id: ColumnId, inputType: string, data: string | null, result: string): boolean {
  const box = wip(id);
  if (!box.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }))) return false;
  box.value = result;
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
  return true;
}

// The box is left, or Enter is pressed: `change` fires with whatever the box holds.
function leaveLimit(id: ColumnId): void {
  wip(id).dispatchEvent(new Event('change', { bubbles: true }));
}

function warning(id: ColumnId): HTMLElement {
  const found = column(id).querySelector<HTMLElement>('.wip-warning');
  if (!found) throw new Error(`no warning in ${id}`);
  return found;
}

function warnings(): string[] {
  return COLUMN_IDS.map((id) => warning(id).textContent ?? '');
}

function boxes(): string[] {
  return COLUMN_IDS.map((id) => wip(id).value);
}

function storedLimits() {
  const { columns } = parseBoard(localStorage.getItem(KEY) ?? '');
  return { todo: columns.todo.wipLimit, doing: columns.doing.wipLimit, done: columns.done.wipLimit };
}

beforeEach(() => {
  localStorage.clear();
  counter = 0;
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const realSetTimeout = globalThis.setTimeout; // vi.useFakeTimers() replaces the global one, and the import tests wait on a real one
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone; // read before any test changes TZ
const HOST_OFFSET = new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset();
const IMPORT_FAILED = 'Could not import the file: ';
const IMPORT_CONFIRM = 'Replace the whole board with the one in this file? The board you have now will be lost.';
const NOT_JSON = 'The file is not valid JSON.';
const UNREADABLE = 'it could not be read.';

// The text of a board file; the key order is the one serializeBoard writes.
function boardText(cards: Partial<Record<ColumnId, Card[]>>, limits: Partial<Record<ColumnId, number>> = {}): string {
  return JSON.stringify({ version: 1, columns: Object.fromEntries(COLUMN_IDS.map((id) => [id, { wipLimit: limits[id] ?? null, cards: cards[id] ?? [] }])) });
}

const IMPORTED = boardText(
  {
    todo: [
      { id: 'n1', title: 'Imported one', note: 'from a file', due: '2027-01-02' },
      { id: 'n2', title: 'Imported two', note: '', due: null },
    ],
    done: [{ id: 'n3', title: 'Imported three', note: '', due: null }],
  },
  { todo: 1, done: 3 },
);

function fileOf(content: string | Uint8Array<ArrayBuffer>, name = 'board.json'): File {
  return new File([content], name, { type: 'application/json' });
}

function unreadableFile(): File {
  const file = fileOf('{}');
  vi.spyOn(file, 'text').mockRejectedValue(new DOMException('gone', 'NotReadableError'));
  return file;
}

function reasonOf(text: string): string {
  try {
    parseBoard(text);
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
  throw new Error('parseBoard accepted the text');
}

function importBox(): HTMLInputElement {
  const box = field(root, 'Import board from JSON');
  if (!(box instanceof HTMLInputElement)) throw new Error('the import control is not an input');
  return box;
}

// jsdom cannot hold a chosen file, so the box is given what Chromium's file input does (measured): `files` holds the choice, `value`
// reports it and, set to '', empties it, and choosing the file the box already holds fires no `change`. Returns when the app is done:
// reading a file settles within microtasks in jsdom 29 and everything after it is synchronous, so one real timer turn is enough.
const held = new WeakMap<HTMLInputElement, File[]>();

async function chooseFile(file: File): Promise<void> {
  const box = importBox();
  if (!held.has(box)) {
    held.set(box, []);
    Object.defineProperties(box, {
      files: { configurable: true, get: () => held.get(box) },
      value: {
        configurable: true,
        get: () => (held.get(box)?.length ? `C:\\fakepath\\${held.get(box)?.[0].name}` : ''),
        set: (text: string) => {
          if (text === '') held.set(box, []);
        },
      },
    });
  }
  if (held.get(box)?.[0] === file) return;
  held.set(box, [file]);
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => realSetTimeout(resolve, 0));
}

function confirmWith(answer: boolean) {
  return vi.spyOn(window, 'confirm').mockReturnValue(answer);
}

// The browser parts of a download, replaced: the Blob given to URL.createObjectURL, the link that was clicked as it was at that moment,
// and the revocations.
function stubDownload() {
  const clicked: { href: string; download: string; inPage: boolean }[] = [];
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:loopboard-test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download, inPage: this.isConnected });
  });
  return { clicked, create, revoke };
}

function exportedBlob(create: ReturnType<typeof stubDownload>['create']): Blob {
  const [blob] = create.mock.calls[0];
  if (!(blob instanceof Blob)) throw new Error('createObjectURL was not given a Blob');
  return blob;
}

// The seeded board stored as indented JSON: any save at all would change these bytes, so "untouched" can be checked byte for byte.
function seedIndented(): string {
  seed();
  const text = JSON.stringify(JSON.parse(localStorage.getItem(KEY) ?? ''), null, 2);
  localStorage.setItem(KEY, text);
  start();
  return text;
}

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
    button('Save "Buy milk"').click();
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
    button('Cancel editing "Buy milk"').click();
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
    button('Save "Buy milk"').click();
    expect(editForm().querySelector('.form-error')?.textContent).toBe(BLANK_TITLE);
    expect(field(editForm(), 'Note').value).toBe('kept');
    expect(localStorage.getItem(KEY)).toBe(before);
    field(editForm(), 'Title').value = 'Fixed';
    button('Save "Buy milk"').click(); // named after the stored title, not the typed one
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
    button('Cancel editing "New"').click();
    expect(saved).toHaveLength(1);
    button('Edit "New"').click();
    button('Save "New"').click();
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
    button('Save "Write report"').click();
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
    ['moves a card to another column', () => button('Move "Buy milk" to Done').click(), { todo: ['From A'], doing: ['Fix bike (A)'], done: ['Pay rent', 'Buy milk'] }],
    ['moves a card the other tab renamed', () => button('Move "Fix bike" to Done').click(), { todo: ['Buy milk', 'From A'], doing: [], done: ['Pay rent', 'Fix bike (A)'] }],
    ['sets a WIP limit', () => typeLimit('doing', '2'), { todo: ['Buy milk', 'From A'], doing: ['Fix bike (A)'], done: ['Pay rent'] }],
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

  it('a stale tab that moves a card the other tab renamed announces the title that is stored', () => {
    vi.useFakeTimers();
    staleTab();
    button('Move "Fix bike" to Done').click();
    vi.advanceTimersByTime(100);
    expect(status().textContent).toBe('Moved "Fix bike (A)" to Done');
  });

  it('a stale tab that moves a card the other tab deleted changes nothing: no save, no announcement, the button keeps focus', () => {
    vi.useFakeTimers();
    staleTab();
    const before = localStorage.getItem(KEY);
    const pressed = button('Move "Write report" to Doing');
    pressed.focus();
    pressed.click();
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(alerts()[0].textContent).toBe('');
    expect(document.activeElement).toBe(pressed);
    vi.advanceTimersByTime(1000);
    expect(status().textContent).toBe('');
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
    button(`Save "${title}"`).click();
    expect(storedCards('todo')).toEqual([{ id: 'a', title, note: 'a note', due: null }]);
    expect(cardsIn('todo')[0].title).toBe(title);
  });

  it('Save after changing only the note keeps the title', () => {
    openEditor(TITLES[0]);
    field(editForm(), 'Note').value = 'changed';
    button(`Save "${TITLES[0]}"`).click();
    expect(storedCards('todo')).toEqual([{ id: 'a', title: TITLES[0], note: 'changed', due: null }]);
  });

  it('Save after typing a new title stores what was typed', () => {
    openEditor(TITLES[0]);
    field(editForm(), 'Title').value = 'Replaced';
    button(`Save "${TITLES[0]}"`).click(); // named after the stored title, not the typed one
    expect(storedCards('todo')[0].title).toBe('Replaced');
  });

  it.each(TITLES)('the editor of %j has names that hold the title exactly as stored', (title) => {
    openEditor(title);
    const names = [...editForm().querySelectorAll('input, textarea, button')].map((control) => control.getAttribute('aria-label'));
    expect(names).toEqual([`Title for "${title}"`, `Note for "${title}"`, `Due date for "${title}"`, `Save "${title}"`, `Cancel editing "${title}"`]);
  });
});

describe('moving cards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('Move buttons', () => {
    it.each([
      ['Buy milk', ['Doing', 'Done']],
      ['Fix bike', ['To do', 'Done']],
      ['Pay rent', ['To do', 'Doing']],
    ] as const)('"%s" has Edit, Delete, then one Move button for each other column', (title, others) => {
      seed();
      const buttons = [...cardItem(title).querySelectorAll('button')];
      expect(buttons.map((control) => control.getAttribute('aria-label'))).toEqual([
        `Edit "${title}"`,
        `Delete "${title}"`,
        ...others.map((name) => `Move "${title}" to ${name}`),
      ]);
      expect(buttons.map((control) => control.type)).toEqual(buttons.map(() => 'button'));
      expect(buttons.slice(2).map((control) => control.textContent)).toEqual(others.map((name) => `\u2192 ${name}`));
    });

    it('the arrow in a Move button is hidden from assistive technology and is not part of its name', () => {
      seed();
      const moves = [...root.querySelectorAll('button.move')];
      expect(moves).toHaveLength(8);
      for (const move of moves) {
        const arrow = move.querySelector('.arrow');
        expect(arrow?.textContent).toBe('\u2192');
        expect(arrow?.getAttribute('aria-hidden')).toBe('true');
        expect(move.getAttribute('aria-label')).not.toContain('\u2192');
      }
    });

    it.each([
      ['Buy milk', 'Doing', 'doing'],
      ['Buy milk', 'Done', 'done'],
      ['Fix bike', 'To do', 'todo'],
      ['Fix bike', 'Done', 'done'],
      ['Pay rent', 'To do', 'todo'],
      ['Pay rent', 'Doing', 'doing'],
    ] as const)('Move "%s" to %s puts the card at the end of that column and saves', (title, name, id) => {
      seed();
      const expected = titlesByColumn(cardsIn);
      for (const other of COLUMN_IDS) expected[other] = expected[other].filter((candidate) => candidate !== title);
      expected[id].push(title);
      button(`Move "${title}" to ${name}`).click();
      expect(titlesByColumn(cardsIn)).toEqual(expected);
      expect(titlesByColumn(storedCards)).toEqual(expected);
      expect(COLUMN_IDS.map((other) => column(other).querySelector('.count')?.textContent)).toEqual(
        COLUMN_IDS.map((other) => `${expected[other].length} ${expected[other].length === 1 ? 'card' : 'cards'}`),
      );
    });

    it("keeps the card's id, note and due date", () => {
      seed();
      button('Move "Buy milk" to Done').click();
      expect(storedCards('done')).toEqual([
        { id: 'd', title: 'Pay rent', note: 'Paid online', due: '2026-11-01' },
        { id: 'a', title: 'Buy milk', note: '2 litres', due: '2026-11-20' },
      ]);
      expect(cardsIn('done')[1]).toEqual({ title: 'Buy milk', note: '2 litres', due: 'Due 2026-11-20' });
    });
  });

  describe('after a move', () => {
    it('focus is on the moved card in its new column (tabindex -1), not on <body>, after a Move button', () => {
      seed();
      const pressed = button('Move "Buy milk" to Doing');
      pressed.focus();
      pressed.click();
      expect(pressed.isConnected).toBe(false); // the redraw removed the button that had focus
      const focused = document.activeElement;
      expect(focused).not.toBe(document.body);
      expect(focused).toBe(cardItem('Buy milk'));
      expect(focused?.tagName).toBe('LI');
      expect(focused?.getAttribute('tabindex')).toBe('-1');
      expect(column('doing').contains(focused)).toBe(true);
    });

    it('focus is on the moved card in its new column after a drop too', () => {
      seed();
      drag('Fix bike', column('done'));
      const focused = document.activeElement;
      expect(focused).toBe(cardItem('Fix bike'));
      expect(focused?.getAttribute('tabindex')).toBe('-1');
      expect(column('done').contains(focused)).toBe(true);
    });

    it('every tabindex on the page is -1', () => {
      seed();
      button('Move "Buy milk" to Doing').click();
      const tabindexes = [...root.querySelectorAll('[tabindex]')];
      expect(tabindexes).toHaveLength(4); // the three column headings and the moved card
      expect(tabindexes.every((element) => element.getAttribute('tabindex') === '-1')).toBe(true);
    });

    it('announces Moved "<title>" to <Column> in the role="status" region, after a short delay', () => {
      seed();
      expect(status().getAttribute('role')).toBe('status');
      expect(status().textContent).toBe('');
      button('Move "Buy milk" to Doing').click();
      expect(status().textContent).toBe('');
      vi.advanceTimersByTime(100);
      expect(status().textContent).toBe('Moved "Buy milk" to Doing');
      drag('Pay rent', column('todo'));
      vi.advanceTimersByTime(100);
      expect(status().textContent).toBe('Moved "Pay rent" to To do');
    });

    it('the status region is one element outside the columns, and the one role="alert" is still there', () => {
      seed();
      expect(root.querySelectorAll('.move-status')).toHaveLength(1);
      expect(root.querySelector('main')?.contains(status())).toBe(false);
      expect(status().hasAttribute('hidden')).toBe(false);
      expect(alerts()).toHaveLength(1);
    });

    it('announces the same message twice in a row: the region is empty in between', () => {
      let board = addCard(emptyBoard(), 'todo', { id: 'a', title: 'Same', note: '', due: null });
      board = addCard(board, 'todo', { id: 'b', title: 'Same', note: '', due: null });
      localStorage.setItem(KEY, serializeBoard(board));
      start();
      const seen: string[] = [];
      cardItem('Same').querySelector<HTMLButtonElement>('button.move')?.click(); // the first Same, to Doing
      vi.advanceTimersByTime(100);
      seen.push(status().textContent ?? '');
      cardItem('Same').querySelector<HTMLButtonElement>('button.move')?.click(); // the other Same, to Doing
      seen.push(status().textContent ?? '');
      vi.advanceTimersByTime(100);
      seen.push(status().textContent ?? '');
      expect(seen).toEqual(['Moved "Same" to Doing', '', 'Moved "Same" to Doing']);
    });

    it('a move whose save fails stays on screen, shows the one alert, and is still announced', () => {
      seed();
      start(storageWith({ setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }));
      button('Move "Buy milk" to Doing').click();
      vi.advanceTimersByTime(100);
      expect(cardsIn('doing').map((card) => card.title)).toEqual(['Fix bike', 'Buy milk']);
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0].textContent).toBe(SAVE_FAILED);
      expect(status().textContent).toBe('Moved "Buy milk" to Doing');
    });
  });

  describe('drag and drop', () => {
    it('cards are draggable, except the one being edited, which has no Move buttons either', () => {
      seed();
      expect([...root.querySelectorAll('li.card')].map((item) => item.getAttribute('draggable'))).toEqual(['true', 'true', 'true', 'true']);
      button('Edit "Buy milk"').click();
      const editing = editForm().closest('li');
      expect(editing?.hasAttribute('draggable')).toBe(false);
      expect(editing?.querySelector('.move')).toBeNull();
      expect(root.querySelectorAll('li.card[draggable="true"]')).toHaveLength(3);
    });

    it('dragstart puts the card id in dataTransfer under the card type and allows only a move', () => {
      seed();
      const transfer = transferOf();
      fire(cardItem('Fix bike'), 'dragstart', transfer);
      expect(transfer.types).toEqual([CARD_TYPE]);
      expect(transfer.getData(CARD_TYPE)).toBe('c');
      expect(transfer.effectAllowed).toBe('move');
    });

    it.each([
      ['Buy milk', 'doing'],
      ['Fix bike', 'done'],
      ['Pay rent', 'todo'],
    ] as const)('dropping "%s" on the %s column region moves it to the end of that column and saves', (title, id) => {
      seed();
      const expected = titlesByColumn(cardsIn);
      for (const other of COLUMN_IDS) expected[other] = expected[other].filter((candidate) => candidate !== title);
      expected[id].push(title);
      drag(title, column(id));
      expect(titlesByColumn(cardsIn)).toEqual(expected);
      expect(titlesByColumn(storedCards)).toEqual(expected);
    });

    it.each([
      ['its heading', 'h2'],
      ['its count', '.count'],
      ['its card list', 'ul'],
      ['a card in it', 'li'],
    ])('a drop on %s, inside the column region, moves the card there', (_where, selector) => {
      seed();
      drag('Buy milk', within('done', selector));
      expect(titlesByColumn(storedCards)).toEqual({ todo: ['Write report'], doing: ['Fix bike'], done: ['Pay rent', 'Buy milk'] });
    });

    it('dropping a card on its own column changes nothing: nothing saved, redrawn, announced or focused', () => {
      seed();
      const saved: string[] = [];
      start(storageWith({ setItem: (key, value) => { saved.push(value); localStorage.setItem(key, value); } }));
      const before = everything();
      const item = cardItem('Buy milk');
      button('Edit "Write report"').focus();
      drag('Buy milk', column('todo'));
      expect(saved).toEqual([]);
      expect(everything()).toEqual(before);
      expect(cardItem('Buy milk')).toBe(item);
      expect(document.activeElement).toBe(button('Edit "Write report"'));
      vi.advanceTimersByTime(1000);
      expect(status().textContent).toBe('');
    });

    it('dragenter and dragover accept one of our cards: cancelled, move effect, and only that column is marked', () => {
      seed();
      const transfer = transferOf();
      fire(cardItem('Buy milk'), 'dragstart', transfer);
      expect(fire(column('doing'), 'dragenter', transfer).defaultPrevented).toBe(true);
      expect(fire(column('doing'), 'dragover', transfer).defaultPrevented).toBe(true);
      expect(transfer.dropEffect).toBe('move');
      expect(marked()).toEqual([false, true, false]);
    });

    it('a drag that is not one of our cards is ignored: not accepted, not marked, and a drop changes nothing', () => {
      seed();
      const before = localStorage.getItem(KEY);
      for (const transfer of [transferOf({ 'text/plain': 'a' }), transferOf({ Files: '' }), transferOf()]) {
        expect(fire(column('done'), 'dragover', transfer).defaultPrevented).toBe(false);
        expect(marked()).toEqual([false, false, false]);
        expect(fire(column('done'), 'drop', transfer).defaultPrevented).toBe(false);
      }
      expect(localStorage.getItem(KEY)).toBe(before);
      expect(cardsIn('done')).toHaveLength(1);
    });

    it('a drop of a card id that no card has changes nothing', () => {
      seed();
      const before = localStorage.getItem(KEY);
      fire(column('done'), 'drop', transferOf({ [CARD_TYPE]: 'gone' }));
      expect(localStorage.getItem(KEY)).toBe(before);
      expect(everything().done).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(status().textContent).toBe('');
    });

    it("the drop-target style stays while the pointer moves between the column's own elements, and goes when it leaves", () => {
      seed();
      const transfer = transferOf({ [CARD_TYPE]: 'a' });
      const doing = column('doing');
      const card = within('doing', 'li');
      fire(doing, 'dragover', transfer);
      expect(marked()).toEqual([false, true, false]);
      fire(doing, 'dragleave', transfer, card); // from the section into a card
      fire(card, 'dragleave', transfer, doing); // from the card back to the section
      fire(card, 'dragleave', transfer, within('doing', 'h2')); // from a card to the heading
      expect(marked()).toEqual([false, true, false]);
      fire(card, 'dragleave', transfer, column('done')); // into another column
      expect(marked()).toEqual([false, false, false]);
      fire(doing, 'dragover', transfer);
      fire(doing, 'dragleave', transfer, null); // out of the window
      expect(marked()).toEqual([false, false, false]);
    });

    it('dragend clears the style of every column, and a drop clears it too', () => {
      seed();
      const transfer = transferOf();
      fire(cardItem('Buy milk'), 'dragstart', transfer);
      fire(column('doing'), 'dragover', transfer);
      fire(column('done'), 'dragover', transfer); // two columns marked, as if a dragleave never came
      expect(marked()).toEqual([false, true, true]);
      fire(cardItem('Buy milk'), 'dragend', transfer);
      expect(marked()).toEqual([false, false, false]);
      fire(column('done'), 'dragover', transfer);
      fire(column('done'), 'drop', transfer);
      expect(marked()).toEqual([false, false, false]);
    });
  });

  describe('ARIA', () => {
    it('each card list has an aria-label naming its column', () => {
      start();
      expect(COLUMN_IDS.map((id) => within(id, 'ul').getAttribute('aria-label'))).toEqual(['To do cards', 'Doing cards', 'Done cards']);
    });

    it('every button on a card has a name that contains the card title', () => {
      seed();
      const items = [...root.querySelectorAll('li.card')];
      expect(items).toHaveLength(4);
      for (const item of items) {
        const title = item.querySelector('h3')?.textContent ?? '';
        const buttons = [...item.querySelectorAll('button')];
        expect(buttons).toHaveLength(4); // Edit, Delete and two Move buttons
        for (const control of buttons) expect(control.getAttribute('aria-label')).toContain(`"${title}"`);
      }
    });

    it('every control of an open edit form has a name that contains the stored title and keeps its visible caption', () => {
      seed();
      const captions = ['Title', 'Note', 'Due date', 'Save', 'Cancel'];
      for (const title of ['Buy milk', 'Write report', 'Fix bike', 'Pay rent']) {
        button(`Edit "${title}"`).click();
        const form = editForm();
        expect([...form.querySelectorAll('label, button')].map((item) => item.textContent)).toEqual(captions);
        const names = [...form.querySelectorAll('input, textarea, button')].map((control) => control.getAttribute('aria-label') ?? '');
        expect(names).toEqual([`Title for "${title}"`, `Note for "${title}"`, `Due date for "${title}"`, `Save "${title}"`, `Cancel editing "${title}"`]);
        captions.forEach((caption, index) => expect(names[index]).toContain(caption));
      }
    });

    it('the names in an open edit form do not change while the person types', () => {
      seed();
      button('Edit "Buy milk"').click();
      const names = () => [...editForm().querySelectorAll('input, textarea, button')].map((control) => control.getAttribute('aria-label'));
      const opened = names();
      expect(opened[0]).toBe('Title for "Buy milk"');
      for (const [caption, value] of [['Title', 'Typed title'], ['Note', 'Typed note'], ['Due date', '2027-01-02']] as const) {
        const control = field(editForm(), caption);
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
      expect(names()).toEqual(opened);
    });

    it('the add form keeps its plain names (its visible captions) while an edit form is open', () => {
      seed();
      button('Edit "Buy milk"').click();
      expect([...addForm().querySelectorAll('input, textarea, button')].map((control) => control.getAttribute('aria-label'))).toEqual([null, null, null, null]);
      expect([...addForm().querySelectorAll('label, button')].map((item) => item.textContent)).toEqual(['Title', 'Note', 'Due date', 'Add card']);
    });
  });
});

describe('WIP limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('the box', () => {
    it.each([
      ['todo', 'To do'],
      ['doing', 'Doing'],
      ['done', 'Done'],
    ] as const)('the %s header holds the count and a labelled number input', (id, title) => {
      start();
      const input = wip(id);
      expect(within(id, '.column-header').contains(input)).toBe(true);
      expect(within(id, '.column-header').contains(within(id, '.count'))).toBe(true);
      expect(input.type).toBe('number');
      expect(input.getAttribute('min')).toBe('1');
      expect(input.getAttribute('step')).toBe('1');
      expect(input.value).toBe('');
      expect(input.id).toBe(`${id}-wip`);
      expect(input.getAttribute('aria-label')).toBe(`WIP limit for ${title}`);
      const label = input.closest('label');
      expect(label?.control).toBe(input);
      expect(label?.textContent).toBe('WIP limit');
      expect(input.getAttribute('aria-label')).toContain(label?.textContent ?? '');
      expect(input.hasAttribute('tabindex')).toBe(false);
    });

    it('a valid limit is saved for that column only, and after a reload the box shows it', () => {
      seed();
      typeLimit('doing', '3');
      expect(storedLimits()).toEqual({ todo: null, doing: 3, done: null });
      expect(titlesByColumn(storedCards)).toEqual({ todo: ['Buy milk', 'Write report'], doing: ['Fix bike'], done: ['Pay rent'] });
      expect(boxes()).toEqual(['', '3', '']);
      root.replaceChildren();
      start();
      expect(boxes()).toEqual(['', '3', '']);
    });

    it.each([
      ['3', 3],
      ['1', 1],
      ['007', 7],
      ['1e2', 100],
    ])('the text %j is saved as the limit %d, and the focused box then shows the number', (text, limit) => {
      start();
      wip('todo').focus(); // as when Enter is pressed: the box keeps focus, so a redraw leaves it alone
      typeLimit('todo', text);
      expect(storedLimits().todo).toBe(limit);
      expect(wip('todo').value).toBe(String(limit));
    });

    it('an empty box means no limit: it clears a stored limit and saves null', () => {
      start();
      typeLimit('doing', '2');
      expect(storedLimits().doing).toBe(2);
      typeLimit('doing', '');
      expect(storedLimits().doing).toBeNull();
      expect(boxes()).toEqual(['', '', '']);
    });

    it('typing alone saves nothing: only the change event commits a limit', () => {
      start();
      for (const text of ['1', '12']) {
        wip('doing').value = text;
        wip('doing').dispatchEvent(new Event('input', { bubbles: true }));
      }
      expect(localStorage.getItem(KEY)).toBeNull();
      wip('doing').dispatchEvent(new Event('change', { bubbles: true }));
      expect(storedLimits().doing).toBe(12);
    });

    describe('a value that is not a positive integer', () => {
      // Doing holds the limit 3, saved once; returns the list of everything that was saved.
      function startWithLimit(): string[] {
        seed();
        const saved: string[] = [];
        start(storageWith({ setItem: (key, value) => { saved.push(value); localStorage.setItem(key, value); } }));
        typeLimit('doing', '3');
        expect(saved).toHaveLength(1);
        return saved;
      }

      it.each(['0', '-1', '1.5', '.5', '1e-1'])('%j is not saved or announced, and the box returns to the stored limit', (text) => {
        const saved = startWithLimit();
        const before = localStorage.getItem(KEY);
        const pressed = button('Edit "Fix bike"');
        pressed.focus();
        typeLimit('doing', text);
        expect(saved).toHaveLength(1);
        expect(localStorage.getItem(KEY)).toBe(before);
        expect(wip('doing').value).toBe('3');
        expect(alerts()[0].textContent).toBe('');
        vi.advanceTimersByTime(1000);
        expect(status().textContent).toBe('');
        expect(warnings()).toEqual(['', '', '']);
        expect(document.activeElement).toBe(pressed);
      });

      it('a box holding text that is not a number (value "" with badInput) is not "no limit"', () => {
        const saved = startWithLimit();
        Object.defineProperty(wip('doing'), 'validity', { value: { badInput: true } }); // jsdom never reports badInput; a browser does for "-" or "e"
        typeLimit('doing', '');
        expect(saved).toHaveLength(1);
        expect(storedLimits().doing).toBe(3);
        expect(wip('doing').value).toBe('3');
      });

      it('a box holding text that is not a number goes back to the stored limit when it loses focus, with no change event', () => {
        startWithLimit();
        Object.defineProperty(wip('doing'), 'validity', { value: { badInput: true } });
        wip('doing').value = '';
        wip('doing').dispatchEvent(new Event('blur'));
        expect(wip('doing').value).toBe('3');
      });

      it('a valid number that was typed and not yet committed is left alone when the box loses focus', () => {
        startWithLimit();
        wip('doing').value = '5';
        wip('doing').dispatchEvent(new Event('blur'));
        expect(wip('doing').value).toBe('5');
        expect(storedLimits().doing).toBe(3);
      });

      describe('text the box cannot show, and a deliberate clear', () => {
        // Measured in Chromium 158: a number box drops the text it cannot show (letters, spaces) but still deletes the selected number
        // that text replaced, so the box looked cleared. `beforeinput` comes first and can be cancelled, which leaves the box as it was.
        it.each([
          ['a letter typed', 'insertText', 'a'],
          ['a space typed', 'insertText', ' '],
          ['a word pasted', 'insertFromPaste', 'abc'],
          ['a word dropped', 'insertFromDrop', 'abc'],
          ['a word as a replacement', 'insertReplacementText', 'abc'],
          ['a paste with no text in it', 'insertFromPaste', null],
        ] as const)('%s over the selected number is stopped: the limit is kept, nothing is saved or announced, and the box still shows it', (_what, inputType, data) => {
          const saved = startWithLimit();
          const before = localStorage.getItem(KEY);
          const pressed = button('Edit "Fix bike"');
          pressed.focus();
          expect(editLimit('doing', inputType, data, '')).toBe(false);
          expect(wip('doing').value).toBe('3');
          expect(saved).toHaveLength(1);
          expect(localStorage.getItem(KEY)).toBe(before);
          expect(alerts()[0].textContent).toBe('');
          vi.advanceTimersByTime(1000);
          expect(status().textContent).toBe('');
          expect(warnings()).toEqual(['', '', '']);
          expect(document.activeElement).toBe(pressed);
        });

        it.each([
          ['a digit, or the new number of ArrowUp, ArrowDown and the spinner', 'insertText', '5'],
          ['an e', 'insertText', 'e'],
          ['a minus sign', 'insertText', '-'],
          ['a plus sign', 'insertText', '+'],
          ['a point', 'insertText', '.'],
          ['a number pasted', 'insertFromPaste', '12'],
          ['a number with letters pasted (the browser keeps the 12)', 'insertFromPaste', '12abc'],
          ['a number with spaces pasted (the browser keeps the 7)', 'insertFromPaste', ' 7 '],
          ['a number dropped', 'insertFromDrop', '7'],
          ['Enter', 'insertLineBreak', null],
        ] as const)('%s is not stopped', (_what, inputType, data) => {
          startWithLimit();
          expect(editLimit('doing', inputType, data, '5')).toBe(true);
          expect(wip('doing').value).toBe('5');
        });

        it.each([
          ['Backspace on the selected number', 'deleteContentBackward'],
          ['Delete on the selected number', 'deleteContentForward'],
          ['cut of the selected number', 'deleteByCut'],
          ['Control+Backspace on the selected number', 'deleteWordBackward'],
          ['dragging the selected number out of the box', 'deleteByDrag'],
        ])('%s is not stopped, and is a deliberate clear: the limit is removed', (_what, inputType) => {
          const saved = startWithLimit();
          expect(editLimit('doing', inputType, null, '')).toBe(true);
          leaveLimit('doing');
          expect(saved).toHaveLength(2);
          expect(storedLimits().doing).toBeNull();
          expect(wip('doing').value).toBe('');
        });

        it('Backspace, Undo and Redo on the selected number: Undo puts the number back and Redo clears it again', () => {
          const saved = startWithLimit();
          expect(editLimit('doing', 'deleteContentBackward', null, '')).toBe(true);
          expect(editLimit('doing', 'historyUndo', null, '3')).toBe(true);
          expect(wip('doing').value).toBe('3');
          expect(editLimit('doing', 'historyRedo', null, '')).toBe(true);
          leaveLimit('doing');
          expect(saved).toHaveLength(2);
          expect(storedLimits().doing).toBeNull();
        });

        it('letters typed over the selected number, then Backspace on it: the number is still selected, so this is a clear', () => {
          const saved = startWithLimit();
          expect(editLimit('doing', 'insertText', 'a', '')).toBe(false);
          expect(editLimit('doing', 'deleteContentBackward', null, '')).toBe(true);
          leaveLimit('doing');
          expect(saved).toHaveLength(2);
          expect(storedLimits().doing).toBeNull();
        });

        it('letters typed over the selected number leave nothing for Undo and Redo to replay: the limit is kept', () => {
          startWithLimit();
          const replayable: string[] = []; // what the browser's Undo would replay: the number that each edit not cancelled replaced
          const shown = wip('doing').value;
          if (editLimit('doing', 'insertText', 'a', '')) replayable.push(shown);
          for (const replaced of replayable) {
            editLimit('doing', 'historyUndo', null, replaced);
            editLimit('doing', 'historyRedo', null, '');
          }
          leaveLimit('doing');
          expect(storedLimits().doing).toBe(3);
          expect(wip('doing').value).toBe('3');
        });

        it('a letter typed over part of the number leaves the whole number as it was', () => {
          startWithLimit();
          typeLimit('doing', '123');
          expect(editLimit('doing', 'insertText', 'a', '13')).toBe(false); // Chromium deletes the selected 2 and drops the a
          expect(wip('doing').value).toBe('123');
          leaveLimit('doing');
          expect(storedLimits().doing).toBe(123);
        });
      });
    });

    it('when saving a limit fails, the limit and its warning stay on screen and the one alert says so', () => {
      seed();
      start(storageWith({ setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }));
      typeLimit('todo', '1');
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0].textContent).toBe(SAVE_FAILED);
      expect(wip('todo').value).toBe('1');
      expect(warning('todo').textContent).toBe('Over WIP limit: 2 of 1');
    });
  });

  describe('the warning', () => {
    it('reads "Over WIP limit: <n> of <limit>" above the limit, and is empty at the limit, under it, and with no limit', () => {
      seed();
      expect(warnings()).toEqual(['', '', '']);
      typeLimit('todo', '3');
      expect(warnings()).toEqual(['', '', '']);
      typeLimit('todo', '2');
      expect(warnings()).toEqual(['', '', '']);
      typeLimit('todo', '1');
      expect(warnings()).toEqual(['Over WIP limit: 2 of 1', '', '']);
      expect(status().textContent).toBe('');
      typeLimit('todo', '');
      expect(warnings()).toEqual(['', '', '']);
    });

    it('is a role="status" element in its own column, right after the header, apart from the page-level move status', () => {
      seed();
      typeLimit('todo', '1');
      const element = warning('todo');
      expect(element.getAttribute('role')).toBe('status');
      expect(element.previousElementSibling).toBe(within('todo', '.column-header'));
      expect(column('todo').querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(within('todo', '[role="status"]')).toBe(element);
      expect(element).not.toBe(status());
      expect(status().getAttribute('role')).toBe('status');
    });

    it('exists in every column from the start, empty, so that a change is announced', () => {
      start();
      expect(COLUMN_IDS.map((id) => column(id).querySelectorAll('[role="status"]').length)).toEqual([1, 1, 1]);
      expect(warnings()).toEqual(['', '', '']);
      expect(root.querySelectorAll('[role="status"]')).toHaveLength(4); // three warnings and the move status
      expect(alerts()).toHaveLength(1);
    });

    it('is still shown after a reload, with no change made', () => {
      seed();
      typeLimit('todo', '1');
      root.replaceChildren();
      start();
      expect(warnings()).toEqual(['Over WIP limit: 2 of 1', '', '']);
      expect(boxes()).toEqual(['1', '', '']);
    });

    it('is not written again while its text is the same: a screen reader would read it again', () => {
      seed();
      typeLimit('todo', '1');
      const observer = new MutationObserver(() => {});
      observer.observe(warning('todo'), { childList: true, characterData: true, subtree: true });
      typeLimit('doing', '5');
      button('Move "Fix bike" to Done').click();
      expect(observer.takeRecords()).toHaveLength(0);
      add('Another');
      expect(observer.takeRecords().length).toBeGreaterThan(0);
      observer.disconnect();
    });
  });

  describe('it follows the board at once', () => {
    beforeEach(() => {
      seed(); // To do 2 cards, Doing 1, Done 1
    });

    it.each([
      ['an add', () => add('Another'), 'Over WIP limit: 3 of 2'],
      ['a move by button', () => button('Move "Fix bike" to To do').click(), 'Over WIP limit: 3 of 2'],
      ['a move by drop', () => drag('Pay rent', column('todo')), 'Over WIP limit: 3 of 2'],
      ['a lower limit', () => typeLimit('todo', '1'), 'Over WIP limit: 2 of 1'],
    ])('%s raises the warning of the column that is now over its limit', (_what, act, text) => {
      typeLimit('todo', '2');
      expect(warnings()).toEqual(['', '', '']);
      act();
      expect(warnings()).toEqual([text, '', '']);
    });

    it.each([
      ['a delete', () => button('Delete "Buy milk"').click()],
      ['a move out by button', () => button('Move "Buy milk" to Doing').click()],
      ['a move out by drop', () => drag('Buy milk', column('done'))],
      ['a higher limit', () => typeLimit('todo', '2')],
      ['clearing the limit', () => typeLimit('todo', '')],
    ])('%s clears it', (_what, act) => {
      typeLimit('todo', '1');
      expect(warnings()).toEqual(['Over WIP limit: 2 of 1', '', '']);
      act();
      expect(warnings()).toEqual(['', '', '']);
    });

    it('one move clears the column it leaves and raises the column it enters', () => {
      typeLimit('todo', '1');
      typeLimit('doing', '1');
      expect(warnings()).toEqual(['Over WIP limit: 2 of 1', '', '']);
      button('Move "Buy milk" to Doing').click();
      expect(warnings()).toEqual(['', 'Over WIP limit: 2 of 1', '']);
    });
  });

  describe('it never blocks', () => {
    beforeEach(() => {
      seed();
      typeLimit('todo', '1'); // To do holds 2 cards: over its limit
      expect(warning('todo').textContent).toBe('Over WIP limit: 2 of 1');
    });

    it('adding a card to an over-limit column still works', () => {
      add('Third');
      expect(cardsIn('todo').map((card) => card.title)).toEqual(['Buy milk', 'Write report', 'Third']);
      expect(storedCards('todo')).toHaveLength(3);
      expect(warning('todo').textContent).toBe('Over WIP limit: 3 of 1');
    });

    it('moving a card into an over-limit column still works, by button and by drop, with its focus and announcement', () => {
      button('Move "Fix bike" to To do').click();
      vi.advanceTimersByTime(100);
      expect(document.activeElement).toBe(cardItem('Fix bike'));
      expect(status().textContent).toBe('Moved "Fix bike" to To do');
      drag('Pay rent', column('todo'));
      expect(titlesByColumn(storedCards)).toEqual({ todo: ['Buy milk', 'Write report', 'Fix bike', 'Pay rent'], doing: [], done: [] });
      expect(warning('todo').textContent).toBe('Over WIP limit: 4 of 1');
    });

    it('disables nothing', () => {
      expect(root.querySelectorAll(':disabled')).toHaveLength(0);
    });
  });

  describe('redrawing', () => {
    it('never overwrites a limit that is being typed into the focused box, and never moves focus', () => {
      seed();
      const box = wip('doing');
      box.focus();
      box.value = '12'; // typed, not committed
      typeLimit('todo', '2'); // another commit redraws every column
      expect(box.value).toBe('12');
      expect(document.activeElement).toBe(box);
      expect(storedLimits()).toEqual({ todo: 2, doing: null, done: null });
    });

    it('a limit change leaves the card lists alone: the same elements, and focus on a card button stays', () => {
      seed();
      const before = [...root.querySelectorAll('li.card')];
      expect(before).toHaveLength(4);
      const pressed = button('Edit "Fix bike"');
      pressed.focus();
      typeLimit('todo', '1');
      const after = [...root.querySelectorAll('li.card')];
      expect(after).toHaveLength(4);
      after.forEach((item, index) => expect(item).toBe(before[index]));
      expect(document.activeElement).toBe(pressed);
    });
  });

  describe('in two tabs', () => {
    it('a limit set in another tab survives an add here, and this tab shows it after the add', () => {
      seed();
      const tabB = openSecondTab();
      typeLimit('doing', '2'); // tab A
      expect(storedLimits().doing).toBe(2);
      root = tabB;
      expect(wip('doing').value).toBe('');
      add('From B');
      expect(storedLimits()).toEqual({ todo: null, doing: 2, done: null });
      expect(wip('doing').value).toBe('2');
    });

    it('a limit set in a stale tab redraws it from storage: the cards another tab saved are listed and counted', () => {
      seed();
      const tabB = openSecondTab();
      add('From A 1');
      add('From A 2');
      root = tabB;
      expect(cardsIn('todo')).toHaveLength(2);
      typeLimit('todo', '3');
      expect(cardsIn('todo').map((card) => card.title)).toEqual(['Buy milk', 'Write report', 'From A 1', 'From A 2']);
      expect(column('todo').querySelector('.count')?.textContent).toBe('4 cards');
      expect(warning('todo').textContent).toBe('Over WIP limit: 4 of 3');
      expect(storedLimits().todo).toBe(3);
      expect(storedCards('todo')).toHaveLength(4);
    });
  });
});

describe('export and import', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.TZ = HOST_ZONE;
  });

  it('has an Export board button and a file input named Import board from JSON that takes JSON files, both ahead of the board', () => {
    start();
    const input = importBox(); // found through its label: the label's text is the input's accessible name
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/json,.json');
    expect(button('Export board').type).toBe('button');
    const tools = root.querySelector('.board-tools');
    expect(tools?.contains(button('Export board'))).toBe(true);
    expect(tools?.contains(input)).toBe(true);
    expect(tools && root.querySelector('main')?.compareDocumentPosition(tools)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  describe('export', () => {
    it('gives the browser a JSON Blob holding exactly what serializeBoard writes, and clicks a download link for its URL', async () => {
      seed();
      const { clicked, create } = stubDownload();
      button('Export board').click();
      expect(create).toHaveBeenCalledTimes(1);
      const blob = exportedBlob(create);
      expect(blob.type).toBe('application/json');
      expect(await blob.text()).toBe(serializeBoard(parseBoard(localStorage.getItem(KEY) ?? '')));
      expect(clicked).toHaveLength(1);
      expect(clicked[0].href).toBe('blob:loopboard-test');
    });

    it('exports the board on screen, not what storage holds now', async () => {
      seed();
      const onScreen = localStorage.getItem(KEY);
      localStorage.removeItem(KEY); // another tab cleared the site data
      const { create } = stubDownload();
      button('Export board').click();
      expect(await exportedBlob(create).text()).toBe(onScreen);
    });

    it.each([
      ['east of UTC, where the local date is a day ahead', 'Pacific/Kiritimati', Date.UTC(2026, 2, 4, 12), 'loopboard-2026-03-05.json'],
      ['west of UTC, where the local date is a day behind', 'Pacific/Pago_Pago', Date.UTC(2026, 0, 10, 5), 'loopboard-2026-01-09.json'],
    ] as const)('names the file with the local date, zero-padded: %s', (_where, zone, instant, name) => {
      vi.useFakeTimers();
      process.env.TZ = zone;
      vi.setSystemTime(instant);
      expect(new Date().getDate()).not.toBe(new Date().getUTCDate()); // the premise: in this zone the two dates differ
      seed();
      const { clicked } = stubDownload();
      button('Export board').click();
      expect(clicked[0].download).toBe(name);
    });

    it('puts the download link in the page for the click and takes it out again', () => {
      seed();
      const { clicked } = stubDownload();
      button('Export board').click();
      expect(clicked[0].inPage).toBe(true);
      expect(root.querySelector('a')).toBeNull();
    });

    it('revokes the object URL after the click: once, and not at once', () => {
      vi.useFakeTimers();
      seed();
      const { clicked, revoke } = stubDownload();
      button('Export board').click();
      expect(clicked).toHaveLength(1);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000);
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:loopboard-test');
    });
  });

  describe('import', () => {
    it('a valid file asks once and, on OK, replaces the whole board: cards, limits, counts, warnings and what is saved', async () => {
      seed();
      const ask = confirmWith(true);
      await chooseFile(fileOf(IMPORTED));
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith(IMPORT_CONFIRM);
      expect(everything()).toEqual({
        todo: [
          { title: 'Imported one', note: 'from a file', due: 'Due 2027-01-02' },
          { title: 'Imported two', note: '', due: '' },
        ],
        doing: [],
        done: [{ title: 'Imported three', note: '', due: '' }],
      });
      expect(COLUMN_IDS.map((id) => column(id).querySelector('.count')?.textContent)).toEqual(['2 cards', '0 cards', '1 card']);
      expect(boxes()).toEqual(['1', '', '3']);
      expect(warnings()).toEqual(['Over WIP limit: 2 of 1', '', '']);
      expect(localStorage.getItem(KEY)).toBe(IMPORTED);
      expect(alerts()[0].textContent).toBe('');
    });

    it('on Cancel nothing changes: not the board, the storage or the page', async () => {
      const stored = seedIndented();
      const page = root.innerHTML;
      const ask = confirmWith(false);
      await chooseFile(fileOf(IMPORTED));
      expect(ask).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(KEY)).toBe(stored);
      expect(root.innerHTML).toBe(page);
    });

    it.each([
      ['text that is not JSON', 'not json', NOT_JSON],
      ['an empty file', '', NOT_JSON],
      ['a binary file', Uint8Array.from({ length: 256 }, (_, index) => index), NOT_JSON],
      ['the wrong version', '{"version":2,"columns":{}}', 'version must be 1.'],
      ['a card without a title', boardText({ todo: [{ id: 'x', title: '', note: '', due: null }] }), 'columns.todo.cards[0].title must be a non-empty string.'],
      [
        'a card id used twice',
        boardText({ todo: [{ id: 'x', title: 'A', note: '', due: null }], doing: [{ id: 'x', title: 'B', note: '', due: null }] }),
        'Card id "x" is used more than once (again at columns.doing.cards[0].id).',
      ],
    ] as const)('%s: the reason is shown in the one alert, and nothing changes', async (_what, content, reason) => {
      const stored = seedIndented();
      const before = { cards: everything(), boxes: boxes(), warnings: warnings() };
      const ask = confirmWith(true);
      await chooseFile(fileOf(content));
      expect(ask).not.toHaveBeenCalled();
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0].textContent).toBe(IMPORT_FAILED + reason);
      expect({ cards: everything(), boxes: boxes(), warnings: warnings() }).toEqual(before);
      expect(localStorage.getItem(KEY)).toBe(stored);
    });

    it('cuts a long reason: a name in the file can be any length', async () => {
      const text = JSON.stringify({ ...JSON.parse(boardText({})), ['x'.repeat(5000)]: 1 });
      const reason = reasonOf(text);
      expect(reason.length).toBeGreaterThan(5000); // the premise: parseBoard repeats the name
      start();
      await chooseFile(fileOf(text));
      expect(alerts()[0].textContent).toBe(`${IMPORT_FAILED}${reason.slice(0, 200)}\u2026`);
    });

    it('a reason that holds markup is shown as text', async () => {
      const name = '<img src=x onerror=alert(1)>';
      start();
      await chooseFile(fileOf(JSON.stringify({ ...JSON.parse(boardText({})), [name]: 1 })));
      expect(alerts()[0].textContent).toBe(`${IMPORT_FAILED}Unexpected property "${name}" in the file.`);
      expect(root.querySelector('img')).toBeNull();
    });

    it('an unreadable file says so in the alert and changes nothing', async () => {
      const stored = seedIndented();
      const ask = confirmWith(true);
      await chooseFile(unreadableFile());
      expect(ask).not.toHaveBeenCalled();
      expect(alerts()[0].textContent).toBe(IMPORT_FAILED + UNREADABLE);
      expect(localStorage.getItem(KEY)).toBe(stored);
    });

    it('a file that starts with a byte order mark imports', async () => {
      start();
      confirmWith(true);
      await chooseFile(fileOf(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(IMPORTED)])));
      expect(cardsIn('todo').map((card) => card.title)).toEqual(['Imported one', 'Imported two']);
      expect(localStorage.getItem(KEY)).toBe(IMPORTED);
    });

    it('a title of <script>alert(1)</script> imports and renders as text', async () => {
      const evil = '<script>alert(1)</script>';
      start();
      confirmWith(true);
      await chooseFile(fileOf(boardText({ todo: [{ id: 'x', title: evil, note: '<b>bold</b>', due: null }] })));
      expect(cardsIn('todo')).toEqual([{ title: evil, note: '<b>bold</b>', due: '' }]);
      expect(root.querySelector('script')).toBeNull();
      expect(root.querySelector('b')).toBeNull();
      expect(root.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('export then import into an empty board reproduces the board', async () => {
      seed();
      typeLimit('todo', '1');
      typeLimit('done', '5');
      const { create } = stubDownload();
      button('Export board').click();
      const exported = await exportedBlob(create).text();
      const shown = { cards: everything(), boxes: boxes(), warnings: warnings() };
      localStorage.clear();
      start();
      expect(everything()).toEqual({ todo: [], doing: [], done: [] }); // the premise: an empty board
      confirmWith(true);
      await chooseFile(fileOf(exported));
      expect({ cards: everything(), boxes: boxes(), warnings: warnings() }).toEqual(shown);
      expect(localStorage.getItem(KEY)).toBe(exported);
    });

    it.each([
      ['accepted', true, () => fileOf(IMPORTED)],
      ['cancelled', false, () => fileOf(IMPORTED)],
      ['invalid', true, () => fileOf('not json')],
      ['unreadable', true, unreadableFile],
    ] as const)('the box is empty again after a file that is %s', async (_outcome, answer, makeFile) => {
      seed();
      confirmWith(answer);
      await chooseFile(makeFile());
      expect(importBox().value).toBe('');
      expect(importBox().files).toHaveLength(0);
    });

    it('the same file can be chosen twice in a row', async () => {
      seed();
      const ask = confirmWith(false);
      const file = fileOf(IMPORTED);
      await chooseFile(file);
      await chooseFile(file);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('a change event with no file in the box does nothing', async () => {
      seed();
      const ask = confirmWith(true);
      const page = root.innerHTML;
      importBox().dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => realSetTimeout(resolve, 0));
      expect(ask).not.toHaveBeenCalled();
      expect(root.innerHTML).toBe(page);
    });

    it('closes an open edit form, even for a card that the file also holds', async () => {
      seed();
      button('Edit "Buy milk"').click();
      field(editForm(), 'Title').value = 'Half typed';
      confirmWith(true);
      await chooseFile(fileOf(boardText({ todo: [{ id: 'a', title: 'Replaced', note: '', due: null }] })));
      expect(root.querySelector('form.edit-form')).toBeNull();
      expect(cardsIn('todo')).toEqual([{ title: 'Replaced', note: '', due: '' }]);
    });

    it('replaces what another tab saved too: the file is the whole board', async () => {
      seed();
      const tabB = openSecondTab();
      add('From A'); // saved by tab A; tab B still shows the old board
      root = tabB;
      confirmWith(true);
      await chooseFile(fileOf(IMPORTED));
      expect(localStorage.getItem(KEY)).toBe(IMPORTED);
      expect(cardsIn('todo').map((card) => card.title)).toEqual(['Imported one', 'Imported two']);
    });

    it('after a failed save the existing alert shows and the imported board stays on screen', async () => {
      seed();
      start(storageWith({ setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }));
      const stored = localStorage.getItem(KEY);
      confirmWith(true);
      await chooseFile(fileOf(IMPORTED));
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0].textContent).toBe(SAVE_FAILED);
      expect(cardsIn('todo').map((card) => card.title)).toEqual(['Imported one', 'Imported two']);
      expect(localStorage.getItem(KEY)).toBe(stored);
    });

    it('the message goes away at the next change that is saved', async () => {
      seed();
      await chooseFile(fileOf('not json'));
      expect(alerts()[0].textContent).toBe(IMPORT_FAILED + NOT_JSON);
      add('Next');
      expect(alerts()[0].textContent).toBe('');
    });
  });

  it('leaves the time zone as the host had it', () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(HOST_OFFSET);
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
    button(`Cancel editing "${evil}"`).click();
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
