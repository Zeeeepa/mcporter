export function stripAnsi(value: string): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\u001B') {
      index += 1;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}
