import { strictJson, utf8Bytes } from '~/util/strictJson';

test('rejects decoded duplicate names before ordinary JSON can collapse them', () => {
  for (const raw of ['{"x":1,"x":2}', '{"x":{"schema_version":1,"\\u0073chema_version":2}}']) {
    expect(() => strictJson(raw, 1024)).toThrow();
  }
});

test('preserves full native numeric lexemes and exact raw property slices', () => {
  const raw =
    '{"firewall": {"version":18446744073709551615,"fields":[]},"policy":{"value":9007199254740993}}';
  const parsed = strictJson(raw, 1024, { captureSource: true, maxDepth: 132 });
  expect(parsed.numberTokens?.get(parsed.value.firewall)?.get('version')).toBe(
    '18446744073709551615'
  );
  expect(parsed.numberTokens?.get(parsed.value.policy)?.get('value')).toBe('9007199254740993');
  const span = parsed.propertySpans?.get(parsed.value)?.get('firewall');
  expect(raw.slice(span?.[0], span?.[1]).trim()).toBe(
    '{"version":18446744073709551615,"fields":[]}'
  );
});

test('preserves integer token types rather than treating exponent/decimal tokens as uints', () => {
  const parsed = strictJson('{"a":1,"b":1.0,"c":1e0,"d":-0,"e":0}', 1024);
  expect([...(parsed.integers.get(parsed.value) ?? [])]).toEqual(['a', 'e']);
});

test('keeps report depth default while allowing native portable metadata depth', () => {
  const raw = '['.repeat(70) + '0' + ']'.repeat(70);
  expect(() => strictJson(raw, 1024)).toThrow();
  expect(() => strictJson(raw, 1024, { maxDepth: 132 })).not.toThrow();
  expect(() =>
    strictJson('['.repeat(133) + '0' + ']'.repeat(133), 1024, { maxDepth: 132 })
  ).toThrow();
});

test('counts UTF8 exactly and rejects nonfinite, trailing and lone-surrogate input', () => {
  expect(utf8Bytes('é😀')).toBe(6);
  expect(() => strictJson('"é"', 3)).toThrow();
  for (const raw of ['1e309', '{"x":0} true', '"\\ud800"', '[1,]', '{"x":1,}'])
    expect(() => strictJson(raw, 1024)).toThrow();
});

test('keeps source capture optional and permits a caller-specified value budget', () => {
  const parsed = strictJson('{"x":[0,0,0]}', 1024);
  expect(parsed.numberTokens).toBeUndefined();
  expect(parsed.propertySpans).toBeUndefined();
  expect(() => strictJson('[0,0,0]', 1024, { maxValues: 3 })).toThrow();
  expect(() => strictJson('[0,0,0]', 1024, { maxValues: 4 })).not.toThrow();
});
