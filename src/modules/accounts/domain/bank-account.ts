/** Pure, testable rules for bank account details. No I/O. */

export type AccountType = 'refund' | 'payout';

/** Nigerian NUBAN account numbers are exactly 10 digits. */
export function isValidAccountNumber(n: string): boolean {
  return /^[0-9]{10}$/.test(n);
}

/** Bank codes are short numeric strings (e.g. 044). */
export function isValidBankCode(code: string): boolean {
  return /^[0-9]{3,6}$/.test(code);
}

/** Never surface a full account number to the client — show only the last 4 digits. */
export function maskAccountNumber(n: string): string {
  const digits = n.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  return '••••••' + digits.slice(-4);
}
