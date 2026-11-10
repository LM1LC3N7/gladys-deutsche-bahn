// -----------------------------------------------------------------------------
// A small XML reader for the Timetables answers: elements and their
// attributes only (the API carries no text content), one pass over the text,
// no backtracking, a bounded number of elements. Prototype keys are never
// used (attributes live in null-prototype objects). Anything malformed throws.
// -----------------------------------------------------------------------------

export class XmlError extends Error {
  constructor(reason) {
    super(`Unreadable XML (${reason})`);
    this.name = 'XmlError';
  }
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_.:-]/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(value) {
  if (!value.includes('&')) {
    return value;
  }
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/**
 * Parses `text` into `{ name, attrs, children }` (the root element).
 * @param {string} text - The XML document.
 * @param {{ maxElements: number }} limits - At most this many elements.
 */
export function parseXml(text, { maxElements = 60000 } = {}) {
  if (typeof text !== 'string') {
    throw new XmlError('not text');
  }
  const stack = [];
  let root;
  let count = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      break;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('declaration');
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('comment');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // No DOCTYPE, no CDATA in this API: refused (no entity expansion).
      throw new XmlError('doctype');
    }
    let j = lt + 1;
    const closing = text[j] === '/';
    if (closing) j += 1;
    if (!NAME_START.test(text[j] ?? '')) throw new XmlError('name');
    const nameStart = j;
    while (j < n && NAME_CHAR.test(text[j])) j += 1;
    const name = text.slice(nameStart, j);
    if (closing) {
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] !== '>') throw new XmlError('end tag');
      const open = stack.pop();
      if (!open || open.name !== name) throw new XmlError('nesting');
      i = j + 1;
      if (stack.length === 0) break;
      continue;
    }
    const attrs = Object.create(null);
    let selfClosing = false;
    for (;;) {
      const before = j;
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] === '>') {
        j += 1;
        break;
      }
      if (text[j] === '/' && text[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (j === before || !NAME_START.test(text[j] ?? '')) throw new XmlError('attribute');
      const keyStart = j;
      while (j < n && NAME_CHAR.test(text[j])) j += 1;
      const key = text.slice(keyStart, j);
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] !== '=') throw new XmlError('attribute value');
      j += 1;
      while (j < n && /\s/.test(text[j])) j += 1;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") throw new XmlError('quote');
      const end = text.indexOf(quote, j + 1);
      if (end < 0) throw new XmlError('unterminated value');
      const raw = text.slice(j + 1, end);
      if (raw.includes('<')) throw new XmlError('value');
      if (!(key in attrs)) attrs[key] = decodeEntities(raw);
      j = end + 1;
    }
    count += 1;
    if (count > maxElements) throw new XmlError('too many elements');
    const node = { name, attrs, children: [] };
    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else if (root) {
      throw new XmlError('two roots');
    } else {
      root = node;
    }
    if (!selfClosing) stack.push(node);
    i = j;
    if (selfClosing && stack.length === 0) break;
  }
  if (!root || stack.length) {
    throw new XmlError(root ? 'unclosed' : 'empty');
  }
  if (text.indexOf('<', i) >= 0) {
    throw new XmlError('after the root');
  }
  return root;
}
