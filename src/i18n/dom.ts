/**
 * Aplica un traductor a lo que se ve en la página y lo mantiene al día.
 *
 * Solo cambia el contenido de los nodos de texto y algunos atributos visibles (placeholder, title,
 * aria-label, alt). No reemplaza nodos: React sigue siendo dueño de los mismos nodos y, cuando los
 * actualiza, el observador traduce el texto nuevo. Al volver al español, cada texto recupera el
 * original que tenía.
 */
import type { Translator } from "./translator";

const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;
/** Dentro de estos elementos no se traduce: código, campos que escribe el usuario, o lo marcado a mano. */
const SKIP = "script, style, textarea, code, pre, [contenteditable], [data-sin-traducir]";

interface Record_ {
  es: string;
  en: string;
}

const textOriginals = new WeakMap<Text, Record_>();
const attrOriginals = new WeakMap<Element, Map<string, Record_>>();

let translator: Translator | null = null;
let observer: MutationObserver | null = null;
let originalTitle: string | null = null;
let nativeConfirm: typeof window.confirm | null = null;
let nativeAlert: typeof window.alert | null = null;

const skipped = (el: Element | null) => !el || el.closest(SKIP) !== null;

function translateText(node: Text) {
  if (!translator || skipped(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  const known = textOriginals.get(node);
  if (known && current === known.en) return; // es el que pusimos nosotros
  const en = translator.translate(current);
  if (en === null) {
    textOriginals.delete(node);
    return;
  }
  textOriginals.set(node, { es: current, en });
  node.nodeValue = en;
}

function translateAttribute(el: Element, name: string) {
  if (!translator || skipped(el)) return;
  const current = el.getAttribute(name);
  if (current === null) return;
  let map = attrOriginals.get(el);
  const known = map?.get(name);
  if (known && current === known.en) return;
  const en = translator.translate(current);
  if (en === null) {
    map?.delete(name);
    return;
  }
  if (!map) attrOriginals.set(el, (map = new Map()));
  map.set(name, { es: current, en });
  el.setAttribute(name, en);
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const el = root as Element;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skipped(el)) return;
    for (const a of ATTRIBUTES) if (el.hasAttribute(a)) translateAttribute(el, a);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
    else for (const a of ATTRIBUTES) if ((n as Element).hasAttribute(a)) translateAttribute(n as Element, a);
  }
}

function restoreTree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n as Text;
      const known = textOriginals.get(text);
      if (known && text.nodeValue === known.en) text.nodeValue = known.es;
      textOriginals.delete(text);
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      const map = attrOriginals.get(el);
      if (!map) continue;
      for (const [name, known] of map) if (el.getAttribute(name) === known.en) el.setAttribute(name, known.es);
      attrOriginals.delete(el);
    }
  }
}

/** Empieza a traducir la página (o cambia de traductor si ya estaba en marcha). */
export function startTranslating(next: Translator) {
  translator = next;
  if (!observer) {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData") translateText(m.target as Text);
        else if (m.type === "attributes") translateAttribute(m.target as Element, m.attributeName!);
        else m.addedNodes.forEach(translateTree);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
  }
  translateTree(document.body);
  if (originalTitle === null) originalTitle = document.title;
  document.title = next.translate(originalTitle) ?? originalTitle;
  // Los avisos del navegador (confirmar un borrado, por ejemplo) también.
  if (!nativeConfirm) {
    nativeConfirm = window.confirm;
    nativeAlert = window.alert;
    window.confirm = (message?: string) => nativeConfirm!.call(window, translateMessage(message));
    window.alert = (message?: string) => nativeAlert!.call(window, translateMessage(message));
  }
}

function translateMessage(message?: string) {
  if (message === undefined || !translator) return message;
  return translator.translate(String(message)) ?? message;
}

/** Deja de traducir y devuelve cada texto a su original en español. */
export function stopTranslating() {
  observer?.disconnect();
  observer = null;
  translator = null;
  restoreTree(document.body);
  if (originalTitle !== null) document.title = originalTitle;
  originalTitle = null;
  if (nativeConfirm) {
    window.confirm = nativeConfirm;
    window.alert = nativeAlert!;
    nativeConfirm = nativeAlert = null;
  }
}
