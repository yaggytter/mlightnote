// Exact musical time (APP_DESIGN.md §9.2): quarter note = 1, always reduced
// with a positive denominator. The plain-object shape is also the JSON
// wire shape, so a Rational round-trips through .mlight files unchanged.
export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

export class RationalError extends Error {}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a === 0 ? 1 : a;
}

function checked(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RationalError("rational: overflow");
  return n;
}

export function rat(numerator: number, denominator = 1): Rational {
  if (denominator === 0) throw new RationalError("rational: zero denominator");
  checked(numerator);
  checked(denominator);
  if (numerator === 0) return { numerator: 0, denominator: 1 };
  if (denominator < 0) [numerator, denominator] = [-numerator, -denominator];
  const g = gcd(Math.abs(numerator), denominator);
  return { numerator: numerator / g, denominator: denominator / g };
}

export const ZERO: Rational = rat(0);

/** A MusicXML duration in `divisions` per quarter note, as a Rational. */
export function fromDivisions(duration: number, divisions: number): Rational {
  if (divisions === 0) throw new RationalError("rational: zero divisions");
  return rat(duration, divisions);
}

export function add(a: Rational, b: Rational): Rational {
  return rat(checked(a.numerator * b.denominator) + checked(b.numerator * a.denominator), checked(a.denominator * b.denominator));
}

export function sub(a: Rational, b: Rational): Rational {
  return add(a, { numerator: -b.numerator, denominator: b.denominator });
}

export function compare(a: Rational, b: Rational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isZero(r: Rational): boolean {
  return r.numerator === 0;
}

export function toFloat(r: Rational): number {
  return r.numerator / r.denominator;
}

export function toString(r: Rational): string {
  return `${r.numerator}/${r.denominator}`;
}

/** Reads a stored Rational, tolerating missing values (Go's zero value). */
export function fromJSON(v: unknown): Rational {
  const o = v as Partial<Rational> | null | undefined;
  if (!o || !o.denominator) return ZERO;
  return rat(o.numerator ?? 0, o.denominator);
}
