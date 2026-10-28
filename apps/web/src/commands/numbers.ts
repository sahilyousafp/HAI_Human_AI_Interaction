/** A value read from the words of a transcript, and where the next word starts. */
export interface Read<T> {
  value: T;
  next: number;
}

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const DIGITS = /^(\d+(\.\d+)?|\.\d+)$/;

/** A whole number in words ("twenty five", "one hundred", "hundred", "two thousand"), or null. */
function readWordInteger(words: string[], from: number): Read<number> | null {
  let total = 0;
  let current = 0;
  let i = from;
  while (i < words.length) {
    const word = words[i] as string;
    if (word in ONES) current += ONES[word] as number;
    else if (word in TENS) current += TENS[word] as number;
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else break;
    i++;
  }
  return i === from ? null : { value: total + current, next: i };
}

/** The digits after "point" ("three point five" is 3.5): each word is one digit. */
function readFraction(words: string[], from: number): Read<number> {
  let digits = "";
  let i = from;
  for (; i < words.length; i++) {
    const word = words[i] as string;
    const digit = /^\d$/.test(word) ? Number(word) : ONES[word];
    if (digit === undefined || digit > 9) break;
    digits += digit;
  }
  return { value: digits ? Number(`0.${digits}`) : 0, next: i };
}

/**
 * A number at `from`: digits ("3", "2.5", "-30"), words ("three", "twenty five", "a hundred" once the "a" is gone) or
 * "half", with an optional "minus" or "negative" first. Null when the words there are not a number.
 */
export function readNumber(words: string[], from: number): Read<number> | null {
  let i = from;
  let sign = 1;
  if (words[i] === "minus" || words[i] === "negative") {
    sign = -1;
    i++;
  }
  const word = words[i];
  if (word === undefined) return null;
  if (word === "half") return { value: sign * 0.5, next: i + 1 };
  if (word.startsWith("-") && DIGITS.test(word.slice(1))) {
    return { value: -sign * Number(word.slice(1)), next: i + 1 };
  }
  if (DIGITS.test(word)) return { value: sign * Number(word), next: i + 1 };
  const whole = readWordInteger(words, i);
  if (!whole) return null;
  if (words[whole.next] !== "point") return { value: sign * whole.value, next: whole.next };
  const fraction = readFraction(words, whole.next + 1);
  return { value: sign * (whole.value + fraction.value), next: fraction.next };
}

const UNIT_MM: Record<string, number> = {
  mm: 1,
  millimetre: 1,
  millimetres: 1,
  millimeter: 1,
  millimeters: 1,
  cm: 10,
  centimetre: 10,
  centimetres: 10,
  centimeter: 10,
  centimeters: 10,
  m: 1000,
  metre: 1000,
  metres: 1000,
  meter: 1000,
  meters: 1000,
};

/** A length at `from` in millimetres: a number and an optional unit (millimetres when it has none). */
export function readLength(words: string[], from: number): Read<number> | null {
  const number = readNumber(words, from);
  if (!number) return null;
  const factor = UNIT_MM[words[number.next] ?? ""];
  return factor === undefined
    ? { value: number.value, next: number.next }
    : { value: number.value * factor, next: number.next + 1 };
}
