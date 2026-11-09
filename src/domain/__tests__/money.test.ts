import {
  allocate,
  convert,
  currencyDecimals,
  formatChange,
  formatMoney,
  fromMinor,
  hasRate,
  parseAmount,
  percentChange,
  rateFor,
  sum,
  toInputString,
  toMinor,
} from '../money';

describe('minor units', () => {
  it('knows how many decimals each currency has', () => {
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('jpy')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
  });

  it('converts without floating point drift', () => {
    expect(toMinor(1.005, 'EUR')).toBe(101);
    expect(toMinor(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinor(19.99, 'USD')).toBe(1999);
    expect(toMinor(1500, 'JPY')).toBe(1500);
    expect(toMinor(1.2345, 'KWD')).toBe(1235);
  });

  it('rounds negative amounts the same way as positive ones', () => {
    expect(toMinor(-1.005, 'EUR')).toBe(-101);
    expect(toMinor(-0.004, 'EUR')).toBe(0);
    expect(Object.is(toMinor(-0.004, 'EUR'), -0)).toBe(false);
  });

  it('round-trips', () => {
    expect(fromMinor(1999, 'USD')).toBe(19.99);
    expect(fromMinor(1500, 'JPY')).toBe(1500);
    expect(toInputString(-1234, 'EUR')).toBe('12.34');
    expect(toInputString(900, 'JPY')).toBe('900');
  });
});

describe('parseAmount', () => {
  const eur = (text: string, decimal?: '.' | ',' | 'auto') => parseAmount(text, 'EUR', { decimal });

  it.each([
    ['12.34', 1234],
    ['12', 1200],
    ['0.5', 50],
    ['.5', 50],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['1 234,56', 123456],
    ['12,5', 1250],
    ['0,99', 99],
    ['1,234', 123400],
    ['1,234,567', 123456700],
    ['€ 45.00', 4500],
    ['$1,000', 100000],
    ['+3', 300],
  ])('reads %s', (text, expected) => {
    expect(eur(text)).toBe(expected);
  });

  it.each([
    ['-45', -4500],
    ['(45.00)', -4500],
    ['45.00-', -4500],
    ['€ -12', -1200],
    ['−12,50', -1250],
    ['-€12.50', -1250],
  ])('reads %s as negative', (text, expected) => {
    expect(eur(text)).toBe(expected);
  });

  it('honours an explicit decimal separator', () => {
    expect(eur('1.234', ',')).toBe(123400);
    expect(eur('1.234', '.')).toBe(123);
    expect(eur('1,234', '.')).toBe(123400);
    expect(eur('12,5', ',')).toBe(1250);
  });

  it('respects the currency', () => {
    expect(parseAmount('1,500', 'JPY')).toBe(1500);
    expect(parseAmount('1500.4', 'JPY')).toBe(1500);
    expect(parseAmount('1.2345', 'KWD')).toBe(1235);
  });

  it('returns null when there is no number', () => {
    expect(eur('')).toBeNull();
    expect(eur('   ')).toBeNull();
    expect(eur('abc')).toBeNull();
    expect(eur('-')).toBeNull();
    expect(parseAmount(undefined as unknown as string, 'EUR')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats with the currency and a real minus sign', () => {
    expect(formatMoney(123456, 'USD', { locale: 'en-US' })).toBe('$1,234.56');
    expect(formatMoney(-123456, 'USD', { locale: 'en-US' })).toBe('−$1,234.56');
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500');
  });

  it('supports sign and whole options', () => {
    expect(formatMoney(500, 'USD', { locale: 'en-US', sign: 'always' })).toBe('+$5.00');
    expect(formatMoney(-500, 'USD', { locale: 'en-US', sign: 'never' })).toBe('$5.00');
    expect(formatMoney(0, 'USD', { locale: 'en-US', sign: 'always' })).toBe('$0.00');
    expect(formatMoney(123456, 'USD', { locale: 'en-US', whole: true })).toBe('$1,235');
  });

  it('still shows a number for an unknown currency code', () => {
    expect(formatMoney(1234, 'NOPE', { locale: 'en-US' })).toContain('12.34');
  });
});

describe('allocate', () => {
  it('never loses or invents a cent', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(sum(allocate(46800, new Array(12).fill(1)))).toBe(46800);
    expect(allocate(5, [3, 7])).toEqual([2, 3]);
  });

  it('keeps the sign for negative totals', () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(sum(allocate(-46801, new Array(12).fill(1)))).toBe(-46801);
  });

  it('handles zero and empty input', () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(100, [])).toEqual([]);
    expect(() => allocate(100, [0, 0])).toThrow();
  });
});

describe('currency conversion', () => {
  const rates = { USD: 0.9, GBP: 1.2, JPY: 0.006 };

  it('converts to and from the base currency', () => {
    expect(convert(10000, 'USD', 'EUR', 'EUR', rates)).toBe(9000);
    expect(convert(9000, 'EUR', 'USD', 'EUR', rates)).toBe(10000);
    expect(convert(500, 'EUR', 'EUR', 'EUR', rates)).toBe(500);
  });

  it('converts between two foreign currencies through the base', () => {
    expect(convert(10000, 'GBP', 'USD', 'EUR', rates)).toBe(13333);
  });

  it('accounts for different decimal places', () => {
    expect(convert(10000, 'JPY', 'EUR', 'EUR', rates)).toBe(6000);
    expect(convert(6000, 'EUR', 'JPY', 'EUR', rates)).toBe(10000);
  });

  it('treats a missing rate as 1 and reports it', () => {
    expect(rateFor('CHF', 'EUR', rates)).toBe(1);
    expect(hasRate('CHF', 'EUR', rates)).toBe(false);
    expect(hasRate('EUR', 'EUR', rates)).toBe(true);
    expect(hasRate('USD', 'EUR', rates)).toBe(true);
    expect(rateFor('USD', 'EUR', { USD: -1 })).toBe(1);
  });
});

describe('percentChange', () => {
  it('gives a percentage when there is a baseline', () => {
    expect(percentChange(150, 100)).toEqual({ kind: 'percent', value: 50 });
    expect(percentChange(50, 100)).toEqual({ kind: 'percent', value: -50 });
    expect(percentChange(-50, -100)).toEqual({ kind: 'percent', value: 50 });
  });

  it('never divides by zero', () => {
    expect(percentChange(100, 0)).toEqual({ kind: 'new' });
    expect(percentChange(0, 0)).toEqual({ kind: 'none' });
  });

  it('formats for display', () => {
    expect(formatChange(percentChange(150, 100))).toBe('+50%');
    expect(formatChange(percentChange(50, 100))).toBe('−50%');
    expect(formatChange(percentChange(100, 0))).toBe('New');
    expect(formatChange(percentChange(0, 0))).toBe('No change');
    expect(formatChange(percentChange(1001, 1000))).toBe('No change');
  });
});
