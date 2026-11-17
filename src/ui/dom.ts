/** 다른 곳에서 온 글자는 항상 textContent로만 넣는다 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function link(cls: string, text: string, href: string, newTab = false): HTMLAnchorElement {
  const a = el('a', cls, text);
  a.href = href;
  if (newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  return a;
}

export const fmt = (n: number) => n.toLocaleString('ko-KR');
