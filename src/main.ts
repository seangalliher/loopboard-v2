import { mountApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  mountApp(root, {
    // localStorage is read inside the methods, so a browser that refuses access throws where mountApp can catch it
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
    newId: () => crypto.randomUUID(),
  });
}
