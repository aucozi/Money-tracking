import { buildImportRows, detectDecimal, detectDelimiter, inferMapping, inferOptions, parseCSV, readCSV, toCSV } from '../csv';

describe('parseCSV', () => {
  it('parses plain rows', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quotes, escaped quotes, embedded delimiters and line breaks', () => {
    const text = 'date,payee,amount\n2026-01-02,"Smith, Jones & Co","-12.50"\n2026-01-03,"He said ""hi""",5\n2026-01-04,"two\nlines",1';
    expect(parseCSV(text)).toEqual([
      ['date', 'payee', 'amount'],
      ['2026-01-02', 'Smith, Jones & Co', '-12.50'],
      ['2026-01-03', 'He said "hi"', '5'],
      ['2026-01-04', 'two\nlines', '1'],
    ]);
  });

  it('copes with CRLF, a byte-order mark, blank lines and a trailing newline', () => {
    expect(parseCSV('﻿a,b\r\n1,2\r\n\r\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseCSV('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty cells and trims whitespace', () => {
    expect(parseCSV('a,,c\n , x ,')).toEqual([
      ['a', '', 'c'],
      ['', 'x', ''],
    ]);
  });

  it('detects semicolon, tab and pipe delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
    expect(detectDelimiter('Datum;Betrag\n01.02.2026;-12,50')).toBe(';');
    expect(parseCSV('Datum;Betrag\n01.02.2026;-12,50')).toEqual([
      ['Datum', 'Betrag'],
      ['01.02.2026', '-12,50'],
    ]);
    expect(detectDelimiter('just one column')).toBe(',');
  });

  it('returns nothing for empty input', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV('\n\n')).toEqual([]);
  });
});

describe('readCSV and inferMapping', () => {
  it('recognises common English headers', () => {
    const file = readCSV('Date,Description,Amount,Category\n2026-01-02,Greenway Market,-12.50,Groceries');
    expect(file.headers).toEqual(['Date', 'Description', 'Amount', 'Category']);
    expect(file.lines).toEqual([2]);
    expect(inferMapping(file)).toEqual({ date: 0, payee: 1, amount: 2, category: 3 });
  });

  it('skips the preamble some banks put above the header', () => {
    const text = 'Account statement\nIBAN: XX00 0000\n\nBooking date;Beneficiary;Amount;Currency\n03.02.2026;Landlord;-900,00;EUR';
    const file = readCSV(text);
    expect(file.headers).toEqual(['Booking date', 'Beneficiary', 'Amount', 'Currency']);
    expect(file.rows).toEqual([['03.02.2026', 'Landlord', '-900,00', 'EUR']]);
    expect(file.lines).toEqual([5]);
    expect(inferMapping(file)).toEqual({ date: 0, payee: 1, amount: 2, currency: 3 });
  });

  it('recognises separate money-in and money-out columns', () => {
    const file = readCSV('Transaction Date,Details,Paid out,Paid in\n02/01/2026,Shop,12.50,\n03/01/2026,Employer,,1000');
    expect(inferMapping(file)).toEqual({ date: 0, payee: 1, debit: 2, credit: 3 });
  });

  it('recognises headers in other languages and with accents', () => {
    expect(inferMapping(readCSV('Fecha;Descripción;Importe\n01/02/2026;Tienda;-5,00'))).toEqual({ date: 0, payee: 1, amount: 2 });
    expect(inferMapping(readCSV('Data;Aprašymas;Suma;Valiuta\n2026-02-01;Parduotuvė;-5,00;EUR'))).toEqual({ date: 0, payee: 1, amount: 2, currency: 3 });
    expect(inferMapping(readCSV('Buchungstag;Verwendungszweck;Betrag\n01.02.2026;Miete;-900,00'))).toEqual({ date: 0, payee: 1, amount: 2 });
  });

  it('uses the first matching column when a header appears twice', () => {
    const file = readCSV('Started Date,Completed Date,Description,Amount\n2026-01-01,2026-01-02,Shop,-5');
    expect(inferMapping(file)).toMatchObject({ date: 0, payee: 2, amount: 3 });
  });

  it('works out the columns of a file with no header from the data', () => {
    const file = readCSV('2026-01-02,Greenway Market,-12.50\n2026-01-03,Cinema Nova,-9.00\n2026-01-04,Employer Ltd,1500.00');
    expect(file.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(file.rows).toHaveLength(3);
    expect(inferMapping(file)).toEqual({ date: 0, payee: 1, amount: 2 });
  });

  it('pads ragged rows so columns line up', () => {
    const file = readCSV('Date,Description,Amount,Notes\n2026-01-02,Shop,-5');
    expect(file.rows[0]).toEqual(['2026-01-02', 'Shop', '-5', '']);
  });

  it('copes with an empty file', () => {
    expect(readCSV('')).toEqual({ headers: [], rows: [], lines: [] });
  });
});

describe('detectDecimal and inferOptions', () => {
  it('detects the decimal separator a column uses', () => {
    expect(detectDecimal(['-12,50', '1.234,00'])).toBe(',');
    expect(detectDecimal(['-12.50', '1,234.00'])).toBe('.');
    expect(detectDecimal(['12', '1500'])).toBe('auto');
    expect(detectDecimal(['12,50', '12.50'])).toBe('auto');
  });

  it('infers date order and decimals from the file', () => {
    const file = readCSV('Date;Description;Amount\n25/01/2026;Shop;-1.234,50\n02/02/2026;Shop;-3,00');
    const mapping = inferMapping(file);
    expect(inferOptions(file, mapping, 'EUR')).toEqual({ currency: 'EUR', dateOrder: 'DMY', decimal: ',', flipSign: false });
  });
});

describe('buildImportRows', () => {
  const options = { currency: 'EUR', dateOrder: 'DMY' as const, decimal: 'auto' as const, flipSign: false };

  it('builds rows with cleaned payees and the original descriptor', () => {
    const file = readCSV('Date,Description,Amount,Category,Notes,Currency\n02/01/2026,SQ *LUNA PIZZERIA 0412,-23.80,Dining,with Sam,eur');
    const result = buildImportRows(file, inferMapping(file), options);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        date: '2026-01-02',
        amount: -2380,
        payee: 'Luna Pizzeria',
        rawPayee: 'SQ *LUNA PIZZERIA 0412',
        categoryName: 'Dining',
        notes: 'with Sam',
        currency: 'EUR',
      },
    ]);
  });

  it('combines debit and credit columns into a signed amount', () => {
    const file = readCSV('Date,Details,Paid out,Paid in\n02/01/2026,Shop,12.50,\n03/01/2026,Employer,,1000\n04/01/2026,Odd,-7.00,');
    const result = buildImportRows(file, inferMapping(file), options);
    expect(result.rows.map((row) => row.amount)).toEqual([-1250, 100000, -700]);
  });

  it('flips signs for exports that list purchases as positive', () => {
    const file = readCSV('Date,Description,Amount\n02/01/2026,Shop,12.50\n03/01/2026,Payment received,-100');
    const result = buildImportRows(file, inferMapping(file), { ...options, flipSign: true });
    expect(result.rows.map((row) => row.amount)).toEqual([-1250, 10000]);
  });

  it('reads European number formats when told the decimal separator', () => {
    const file = readCSV('Datum;Beschreibung;Betrag\n02.01.2026;Miete;-1.150,00\n03.01.2026;Kaffee;-3,5');
    const result = buildImportRows(file, inferMapping(file), { ...options, decimal: ',' });
    expect(result.rows.map((row) => row.amount)).toEqual([-115000, -350]);
  });

  it('reports rows it cannot read with their line numbers and keeps the rest', () => {
    const file = readCSV('Date,Description,Amount\n02/01/2026,Shop,-5\nnot a date,Shop,-5\n04/01/2026,Shop,abc\n05/01/2026,Shop,-6\n,,');
    const result = buildImportRows(file, inferMapping(file), options);
    expect(result.rows.map((row) => row.line)).toEqual([2, 5]);
    expect(result.errors).toEqual([
      { line: 3, reason: 'Could not read the date "not a date".' },
      { line: 4, reason: 'Could not read the amount.' },
    ]);
  });

  it('reports the real line of the file, counting blank lines and multi-line cells', () => {
    const file = readCSV('Date,Description,Amount\n\n02/01/2026,"two\nlines",-5\nbad,Shop,-5');
    const result = buildImportRows(file, inferMapping(file), options);
    expect(result.rows.map((row) => row.line)).toEqual([3]);
    expect(result.errors.map((error) => error.line)).toEqual([5]);
  });

  it('skips zero-amount rows and names a blank payee', () => {
    const file = readCSV('Date,Description,Amount\n02/01/2026,Balance check,0.00\n03/01/2026,,-4');
    const result = buildImportRows(file, inferMapping(file), options);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].payee).toBe('Unknown');
  });

  it('asks for the essential columns when they are not mapped', () => {
    const file = readCSV('A,B\nx,y');
    expect(buildImportRows(file, {}, options).errors[0].reason).toMatch(/date/);
    expect(buildImportRows(file, { date: 0 }, options).errors[0].reason).toMatch(/amount/);
  });
});

describe('toCSV', () => {
  it('quotes only what needs quoting', () => {
    expect(toCSV([['a', 'b,c', 'say "hi"', 'two\nlines', 5]])).toBe('a,"b,c","say ""hi""","two\nlines",5');
  });

  it('round-trips through the parser', () => {
    const rows = [
      ['Date', 'Payee', 'Notes'],
      ['2026-01-02', 'Smith, Jones', 'He said "ok"\nthen left'],
    ];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });

  it('defuses spreadsheet formulas but leaves plain numbers alone', () => {
    expect(toCSV([['=SUM(A1:A9)', '+cmd', '@handle', '-12.50', '+3', '-Discount']])).toBe("'=SUM(A1:A9),'+cmd,'@handle,-12.50,+3,'-Discount");
  });
});
