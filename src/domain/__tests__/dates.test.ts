import {
  addDays,
  addMonths,
  addMonthsToKey,
  dayOfWeek,
  daysInMonth,
  detectDateOrder,
  diffDays,
  formatDate,
  formatMonth,
  formatRelative,
  isValidDate,
  makeDate,
  monthEnd,
  monthKey,
  monthLength,
  monthRange,
  monthStart,
  monthsBetween,
  parseFlexibleDate,
  todayISO,
} from '../dates';

describe('calendar arithmetic', () => {
  it('builds and validates dates', () => {
    expect(makeDate(2026, 3, 9)).toBe('2026-03-09');
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
    expect(isValidDate('nope')).toBe(false);
  });

  it('uses the local calendar day for today', () => {
    expect(todayISO(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09');
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('adds days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    // Clocks change on these weekends in Europe and the US.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(diffDays('2026-03-08', '2026-03-09')).toBe(1);
  });

  it('measures days between dates', () => {
    expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffDays('2026-01-31', '2026-01-01')).toBe(-30);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('adds months and clamps to the end of short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('keeps the intended day of month when asked', () => {
    // Without the hint, a 31st bill would drift to the 28th after February.
    expect(addMonths('2026-02-28', 1)).toBe('2026-03-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-01-31', 3, 31)).toBe('2026-04-30');
  });

  it('works with month keys', () => {
    expect(monthKey('2026-11-09')).toBe('2026-11');
    expect(monthStart('2026-11')).toBe('2026-11-01');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthLength('2026-04')).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(addMonthsToKey('2026-11', 2)).toBe('2027-01');
    expect(addMonthsToKey('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-01', '2026-11')).toBe(10);
    expect(monthsBetween('2026-11', '2026-01')).toBe(-10);
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-03', '2026-02')).toEqual([]);
  });

  it('knows the weekday', () => {
    expect(dayOfWeek('2026-11-09')).toBe(1);
    expect(dayOfWeek('2026-11-08')).toBe(0);
  });
});

describe('formatting', () => {
  it('formats dates and months', () => {
    expect(formatDate('2026-11-09')).toBe('9 Nov');
    expect(formatDate('2026-11-09', 'long')).toBe('9 Nov 2026');
    expect(formatDate('2026-11-09', 'weekday')).toBe('Mon, 9 Nov');
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(formatMonth('2026-11', true)).toBe('Nov 2026');
  });

  it('describes dates relative to today', () => {
    const today = '2026-11-09';
    expect(formatRelative('2026-11-09', today)).toBe('Today');
    expect(formatRelative('2026-11-10', today)).toBe('Tomorrow');
    expect(formatRelative('2026-11-08', today)).toBe('Yesterday');
    expect(formatRelative('2026-11-14', today)).toBe('in 5 days');
    expect(formatRelative('2026-11-06', today)).toBe('3 days ago');
    expect(formatRelative('2026-12-25', today)).toBe('25 Dec');
    expect(formatRelative('2027-02-01', today)).toBe('1 Feb 2027');
  });
});

describe('parseFlexibleDate', () => {
  it('reads ISO and compact dates regardless of order', () => {
    expect(parseFlexibleDate('2026-11-03')).toBe('2026-11-03');
    expect(parseFlexibleDate('2026/11/03', 'DMY')).toBe('2026-11-03');
    expect(parseFlexibleDate('20261103')).toBe('2026-11-03');
    expect(parseFlexibleDate('2026-11-03 14:22:10')).toBe('2026-11-03');
    expect(parseFlexibleDate('2026-11-03T14:22:10Z')).toBe('2026-11-03');
  });

  it('follows the requested order for ambiguous dates', () => {
    expect(parseFlexibleDate('03/11/2026', 'DMY')).toBe('2026-11-03');
    expect(parseFlexibleDate('03/11/2026', 'MDY')).toBe('2026-03-11');
    expect(parseFlexibleDate('3.11.2026', 'DMY')).toBe('2026-11-03');
    expect(parseFlexibleDate('11/3/26', 'MDY')).toBe('2026-11-03');
    expect(parseFlexibleDate('26-11-03', 'YMD')).toBe('2026-11-03');
    expect(parseFlexibleDate('1/2/99', 'MDY')).toBe('1999-01-02');
  });

  it('reads month names', () => {
    expect(parseFlexibleDate('3 Nov 2026')).toBe('2026-11-03');
    expect(parseFlexibleDate('03-Nov-26')).toBe('2026-11-03');
    expect(parseFlexibleDate('Nov 3, 2026')).toBe('2026-11-03');
    expect(parseFlexibleDate('November 3rd, 2026')).toBe('2026-11-03');
  });

  it('rejects impossible dates and junk', () => {
    expect(parseFlexibleDate('31/02/2026', 'DMY')).toBeNull();
    expect(parseFlexibleDate('13/13/2026', 'MDY')).toBeNull();
    expect(parseFlexibleDate('hello')).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate('3 Xyz 2026')).toBeNull();
    expect(parseFlexibleDate(null as unknown as string)).toBeNull();
  });
});

describe('detectDateOrder', () => {
  it('spots day-first and month-first columns from the evidence', () => {
    expect(detectDateOrder(['01/02/2026', '25/02/2026'])).toBe('DMY');
    expect(detectDateOrder(['01/02/2026', '02/25/2026'])).toBe('MDY');
    expect(detectDateOrder(['2026-02-25'])).toBe('YMD');
  });

  it('reads dotted dates as day-first when the values alone cannot settle it', () => {
    expect(detectDateOrder(['03.11.2026', '04.11.2026'])).toBe('DMY');
    expect(detectDateOrder(['03.11.2026', '04/11/2026'])).toBe('MDY');
    expect(detectDateOrder(['01.25.2026'])).toBe('MDY');
  });

  it('falls back when nothing settles it', () => {
    expect(detectDateOrder(['01/02/2026', '03/04/2026'])).toBe('MDY');
    expect(detectDateOrder(['01/02/2026', '03/04/2026'], 'DMY')).toBe('DMY');
    expect(detectDateOrder(['not a date'], 'DMY')).toBe('DMY');
  });
});
