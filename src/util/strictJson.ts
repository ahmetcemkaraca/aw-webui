function requireJson(value: unknown): asserts value {
  if (!value) throw new Error('Invalid JSON response');
}

export function utf8Bytes(value: string): number {
  let size = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    requireJson(code !== undefined && (code < 0xd800 || code > 0xdfff));
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

export function strictJson(
  text: string,
  maxBytes: number,
  options: { maxDepth?: number; maxValues?: number; captureSource?: boolean } = {}
) {
  requireJson(typeof text === 'string' && text.length <= maxBytes && utf8Bytes(text) <= maxBytes);
  const maxDepth = options.maxDepth ?? 64;
  const maxValues = options.maxValues ?? 1000000;
  let cursor = 0;
  let values = 0;
  const integers = new WeakMap<object, Set<string>>();
  const numberTokens = options.captureSource
    ? new WeakMap<object, Map<string, string>>()
    : undefined;
  const propertySpans = options.captureSource
    ? new WeakMap<object, Map<string, [number, number]>>()
    : undefined;
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(text[cursor] || '!')) cursor++;
  };
  const string = () => {
    const start = cursor++;
    let closed = false;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') cursor++;
      else if (char === '"') {
        closed = true;
        break;
      }
    }
    requireJson(closed);
    const value = JSON.parse(text.slice(start, cursor));
    requireJson(typeof value === 'string');
    utf8Bytes(value);
    return value as string;
  };
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let integer = false;
  let numberToken: string | null = null;
  const parse = (depth: number): any => {
    requireJson(depth <= maxDepth && ++values <= maxValues);
    whitespace();
    integer = false;
    numberToken = null;
    const char = text[cursor];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      const object = char === '{' ? Object.create(null) : [];
      const keys = new Set<string>();
      const numeric = new Set<string>();
      integers.set(object, numeric);
      const tokens = numberTokens ? new Map<string, string>() : undefined;
      const spans = propertySpans ? new Map<string, [number, number]>() : undefined;
      if (tokens && numberTokens) numberTokens.set(object, tokens);
      if (spans && propertySpans) propertySpans.set(object, spans);
      cursor++;
      whitespace();
      const end = char === '{' ? '}' : ']';
      if (text[cursor] === end) {
        cursor++;
        return object;
      }
      let index = 0;
      for (;;) {
        let key: string;
        if (char === '{') {
          requireJson(text[cursor] === '"');
          key = string();
          requireJson(!keys.has(key));
          keys.add(key);
          whitespace();
          requireJson(text[cursor++] === ':');
        } else key = String(index++);
        const start = cursor;
        const child = parse(depth + 1);
        if (typeof child === 'number') {
          if (integer) numeric.add(key);
          if (tokens && numberToken !== null) tokens.set(key, numberToken);
        }
        spans?.set(key, [start, cursor]);
        object[key] = child;
        whitespace();
        if (text[cursor] === end) {
          cursor++;
          break;
        }
        requireJson(text[cursor++] === ',');
        whitespace();
      }
      return object;
    }
    for (const [token, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(token, cursor)) {
        cursor += token.length;
        return value;
      }
    }
    number.lastIndex = cursor;
    const match = number.exec(text);
    requireJson(match && match.index === cursor);
    cursor += match[0].length;
    const value = Number(match[0]);
    requireJson(Number.isFinite(value));
    integer = !/[.eE]/.test(match[0]) && match[0] !== '-0';
    numberToken = match[0];
    return value;
  };
  const value = parse(0);
  whitespace();
  requireJson(cursor === text.length);
  return { value, integers, numberTokens, propertySpans };
}
