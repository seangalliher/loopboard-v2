import { COLUMNS, addCard, deleteCard, editCard, emptyBoard, moveCard, type Board, type Card, type ColumnId } from '../board';
import { loadBoard, saveBoard } from '../storage';

export type AppDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  newId: () => string;
};

const LOAD_FAILED = 'The saved board could not be read, so the board starts empty.';
const SAVE_FAILED = 'The board could not be saved. Your changes may be lost when you reload.';
const CARD_TYPE = 'application/x-loopboard-card'; // what a dragged card puts in dataTransfer: its id

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function button(text: string, type: 'button' | 'submit' = 'button', className = ''): HTMLButtonElement {
  const element = make('button', className, text);
  element.type = type;
  return element;
}

function errorLine(): HTMLParagraphElement {
  const element = make('p', 'form-error');
  element.setAttribute('aria-live', 'assertive');
  return element;
}

// The three inputs shared by the add form and the edit form.
function cardFields(card?: Card) {
  const stored = card?.title ?? '';
  const title = make('input');
  title.name = 'title';
  title.required = true;
  title.value = stored;
  const shown = title.value; // a single-line input removes LF and CR from the value it is given
  const note = make('textarea');
  note.name = 'note';
  note.value = card?.note ?? '';
  const due = make('input');
  due.type = 'date';
  due.name = 'due';
  due.value = card?.due ?? '';
  const labelled = (text: string, control: HTMLElement): HTMLLabelElement => {
    const label = make('label');
    label.append(make('span', '', text), control);
    // In the edit form each control's name also holds the card's stored title, never the typed one, so it does not change while typing.
    if (card) control.setAttribute('aria-label', `${text} for "${card.title}"`);
    return label;
  };
  return {
    title,
    labels: [labelled('Title', title), labelled('Note', note), labelled('Due date', due)],
    // an empty date input gives '', which isValidDue rejects, so it becomes null here
    read: (): Omit<Card, 'id'> => ({
      title: title.value === shown ? stored : title.value, // left as shown: keep the stored text
      note: note.value,
      due: due.value === '' ? null : due.value,
    }),
  };
}

export function mountApp(root: HTMLElement, { storage, newId }: AppDeps): void {
  let board: Board;
  let startupMessage = '';
  try {
    board = loadBoard(storage);
  } catch {
    board = emptyBoard();
    startupMessage = LOAD_FAILED;
  }
  let editingId: string | null = null;
  let saveFailed = false; // the last save failed, so the board on screen holds changes that storage does not
  const items = new Map<string, HTMLLIElement>(); // card id -> its <li>, refilled by every render()

  const boardAlert = make('p', 'board-alert', startupMessage);
  boardAlert.setAttribute('role', 'alert');

  const status = make('p', 'move-status');
  status.setAttribute('role', 'status');

  const addFields = cardFields();
  const addError = errorLine();
  const addForm = make('form', 'add-form');
  addForm.noValidate = true; // our own message replaces the browser's pop-up
  addForm.setAttribute('aria-label', 'Add a card');
  addForm.append(...addFields.labels, addError, button('Add card', 'submit'));

  const columns = COLUMNS.map(({ id, title }) => {
    const heading = make('h2', '', title);
    heading.id = `${id}-heading`;
    heading.tabIndex = -1;
    const count = make('p', 'count');
    const header = make('div', 'column-header');
    header.append(heading, count);
    const list = make('ul', 'cards');
    list.setAttribute('aria-label', `${title} cards`);
    const section = make('section', 'column');
    section.dataset.column = id;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(header);
    if (id === 'todo') section.append(addForm);
    section.append(list);
    // A card can be dropped anywhere on the column's section, not only on its list.
    const allowDrop = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes(CARD_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      section.classList.add('drop-target');
    };
    section.addEventListener('dragenter', allowDrop);
    section.addEventListener('dragover', allowDrop);
    // dragleave also fires when the pointer moves from the section into one of its own elements: keep the style then.
    section.addEventListener('dragleave', (event) => {
      if (!(event.relatedTarget instanceof Node && section.contains(event.relatedTarget))) section.classList.remove('drop-target');
    });
    section.addEventListener('drop', (event) => {
      const cardId = event.dataTransfer?.getData(CARD_TYPE);
      if (!cardId) return; // not one of our cards
      event.preventDefault();
      clearDropTargets();
      moveTo(cardId, { id, title });
    });
    return { id, heading, count, list, section };
  });

  function commit(next: Board): void {
    board = next;
    try {
      saveBoard(storage, board);
      saveFailed = false;
      boardAlert.textContent = '';
    } catch {
      saveFailed = true;
      boardAlert.textContent = SAVE_FAILED;
    }
    render();
  }

  // The board to build the next change on: what storage holds now, because another tab may have saved since this one loaded.
  // The board on screen is used when the last save failed (storage lacks its changes) or storage cannot be read.
  function latest(): Board {
    if (saveFailed) return board;
    try {
      return loadBoard(storage);
    } catch {
      return board;
    }
  }

  function focusCard(id: string, selector: string): void {
    items.get(id)?.querySelector<HTMLElement>(selector)?.focus();
  }

  function clearDropTargets(): void {
    for (const column of columns) column.section.classList.remove('drop-target');
  }

  // A live region speaks what changes in it. Clearing it first and setting the text in a later task makes a message that
  // repeats the previous one a change too, and it comes after the focus move, which speaks first.
  function announce(message: string): void {
    status.textContent = '';
    setTimeout(() => {
      status.textContent = message;
    }, 100);
  }

  // Used by the Move buttons and by a drop. When moveCard returns the board it was given there is nothing to do: the card is
  // already in that column, or another tab deleted it. Then nothing is saved, redrawn or announced.
  function moveTo(id: string, to: { id: ColumnId; title: string }): void {
    const before = latest();
    const after = moveCard(before, id, to.id);
    if (after === before) return;
    commit(after);
    const item = items.get(id);
    if (item) {
      item.tabIndex = -1;
      item.focus();
    }
    const { cards } = after.columns[to.id]; // moveCard puts the card last
    announce(`Moved "${cards[cards.length - 1].title}" to ${to.title}`);
  }

  function startEdit(id: string): void {
    editingId = id;
    render();
    focusCard(id, 'input[name="title"]');
  }

  function stopEdit(id: string): void {
    editingId = null;
    render();
    focusCard(id, 'button.edit');
  }

  function cardItem(card: Card, heading: HTMLElement, own: ColumnId): HTMLLIElement {
    const item = make('li', 'card');
    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(CARD_TYPE, card.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', clearDropTargets);
    const edit = button('Edit', 'button', 'edit');
    edit.setAttribute('aria-label', `Edit "${card.title}"`);
    edit.addEventListener('click', () => startEdit(card.id));
    const remove = button('Delete', 'button', 'delete');
    remove.setAttribute('aria-label', `Delete "${card.title}"`);
    remove.addEventListener('click', () => {
      commit(deleteCard(latest(), card.id));
      heading.focus();
    });
    const moves = COLUMNS.filter((target) => target.id !== own).map((target) => {
      const arrow = make('span', 'arrow', '\u2192');
      arrow.setAttribute('aria-hidden', 'true');
      const move = button('', 'button', 'move');
      move.append(arrow, ` ${target.title}`);
      move.setAttribute('aria-label', `Move "${card.title}" to ${target.title}`);
      move.addEventListener('click', () => moveTo(card.id, target));
      return move;
    });
    const actions = make('div', 'card-actions');
    actions.append(edit, remove, ...moves);
    item.append(make('h3', 'card-title', card.title));
    if (card.note !== '') item.append(make('p', 'card-note', card.note));
    if (card.due !== null) item.append(make('p', 'card-due', `Due ${card.due}`));
    item.append(actions);
    return item;
  }

  function editItem(card: Card): HTMLLIElement {
    const fields = cardFields(card);
    const error = errorLine();
    const cancel = button('Cancel');
    cancel.setAttribute('aria-label', `Cancel editing "${card.title}"`);
    cancel.addEventListener('click', () => stopEdit(card.id));
    const save = button('Save', 'submit');
    save.setAttribute('aria-label', `Save "${card.title}"`);
    const form = make('form', 'edit-form');
    form.noValidate = true;
    form.append(...fields.labels, error, save, cancel);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      let next: Board;
      try {
        next = editCard(latest(), card.id, fields.read());
      } catch (caught) {
        if (!(caught instanceof RangeError)) throw caught;
        error.textContent = caught.message;
        return;
      }
      editingId = null;
      commit(next);
      focusCard(card.id, 'button.edit');
    });
    const item = make('li', 'card');
    item.append(form);
    return item;
  }

  function render(): void {
    items.clear();
    for (const column of columns) {
      const { cards } = board.columns[column.id];
      column.count.textContent = `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`;
      column.list.replaceChildren(
        ...cards.map((card) => {
          const item = card.id === editingId ? editItem(card) : cardItem(card, column.heading, column.id);
          items.set(card.id, item);
          return item;
        }),
      );
    }
  }

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let next: Board;
    try {
      next = addCard(latest(), 'todo', { id: newId(), ...addFields.read() });
    } catch (caught) {
      if (!(caught instanceof RangeError)) throw caught;
      addError.textContent = caught.message;
      return;
    }
    commit(next);
    addForm.reset();
    addError.textContent = '';
    addFields.title.focus();
  });

  const main = make('main', 'board');
  main.append(...columns.map((column) => column.section));
  render();
  root.replaceChildren(make('h1', '', 'LoopBoard'), boardAlert, status, main);
}
