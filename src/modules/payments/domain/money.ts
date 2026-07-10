/**
 * Money — value object in integer minor units (kobo). Never floats.
 * All arithmetic is exact; invariants are enforced (see 07-engineering-standards §2.6).
 */
export type Currency = 'NGN';

export class Money {
  private constructor(
    public readonly amount: number, // integer minor units (kobo)
    public readonly currency: Currency,
  ) {}

  static of(minorUnits: number, currency: Currency = 'NGN'): Money {
    if (!Number.isInteger(minorUnits)) {
      throw new Error(`Money must be an integer in minor units, got ${minorUnits}`);
    }
    if (minorUnits < 0) {
      throw new Error(`Money cannot be negative, got ${minorUnits}`);
    }
    return new Money(minorUnits, currency);
  }

  static zero(currency: Currency = 'NGN'): Money {
    return new Money(0, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.amount - other.amount;
    if (result < 0) {
      throw new Error('Subtraction would produce a negative amount');
    }
    return new Money(result, this.currency);
  }

  /** Cap this amount at `max` (used so fees never exceed the collected amount). */
  cappedAt(max: Money): Money {
    this.assertSameCurrency(max);
    return new Money(Math.min(this.amount, max.amount), this.currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  gt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  toString(): string {
    return `${this.currency} ${(this.amount / 100).toFixed(2)}`;
  }
}
