import { buildImportRows, detectDecimal, detectDelimiter, detectProfile, inferMapping, inferOptions, parseCSV, readCSV, toCSV } from '../csv';

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

describe('exports from Copilot', () => {
  const header = 'date,name,amount,status,category,parent category,excluded,tags,type,account,account mask,note,recurring';
  const copilot = [
    header,
    '2026-11-03,Corner Bakery,4.50,posted,Restaurants,Food & Drink,false,,regular,Chase Checking,1234,,',
    '2026-11-04,Employer Inc,-3250.00,posted,Paycheck,Income,false,,income,Chase Checking,1234,November pay,',
    '2026-11-05,Credit Card Payment,500.00,posted,,,false,,internal transfer,Chase Checking,1234,,',
    '2026-11-05,Credit Card Payment,-500.00,posted,,,false,,internal transfer,Sapphire Card,9876,,',
    '2026-11-06,Hotel Alba,142.50,pending,Travel,,false,"lisbon, work",regular,Sapphire Card,9876,,',
    '2026-11-07,Reimbursed dinner,60.00,posted,Restaurants,Food & Drink,true,,regular,Sapphire Card,9876,,',
  ].join('\n');

  it('is recognised by its header', () => {
    expect(detectProfile(readCSV(copilot))).toBe('copilot');
    expect(detectProfile(readCSV('Date,Description,Amount\n2026-01-02,Shop,-5'))).toBeUndefined();
    expect(detectProfile(readCSV('date,name,amount,category,parent category,excluded\n2026-01-02,Shop,5,Food,,false'))).toBe('copilot');
  });

  it('maps its columns and turns the signs the right way round', () => {
    const file = readCSV(copilot);
    const mapping = inferMapping(file);
    expect(mapping).toMatchObject({ date: 0, payee: 1, amount: 2, status: 3, category: 4, excluded: 6, tags: 7, type: 8, account: 9, notes: 11 });
    // Spending is written as positive, which the income row (negative) confirms.
    expect(inferOptions(file, mapping, 'USD')).toMatchObject({ profile: 'copilot', flipSign: true, dateOrder: 'YMD' });
  });

  it('trusts the file when its income rows are already positive, and assumes the usual convention when it has none', () => {
    const positiveIncome = readCSV(
      [
        header,
        '2026-11-04,Employer Inc,3250.00,posted,Paycheck,Income,false,,income,Checking,1,,',
        '2026-11-03,Cafe,-4.50,posted,Food,,false,,regular,Checking,1,,',
      ].join('\n'),
    );
    expect(inferOptions(positiveIncome, inferMapping(positiveIncome), 'USD').flipSign).toBe(false);
    const noIncome = readCSV([header, '2026-11-03,Cafe,4.50,posted,Food,,false,,regular,Checking,1,,'].join('\n'));
    expect(inferOptions(noIncome, inferMapping(noIncome), 'USD').flipSign).toBe(true);
  });

  it('reads accounts, transfers, excluded rows, pending status, tags and notes', () => {
    const file = readCSV(copilot);
    const mapping = inferMapping(file);
    const { rows, errors } = buildImportRows(file, mapping, inferOptions(file, mapping, 'USD'));
    expect(errors).toEqual([]);
    expect(rows.map((row) => [row.payee, row.amount, row.accountName, row.categoryName, row.transfer, row.pending, row.tags, row.notes])).toEqual([
      ['Corner Bakery', -450, 'Chase Checking', 'Restaurants', undefined, undefined, undefined, undefined],
      ['Employer Inc', 325000, 'Chase Checking', 'Paycheck', undefined, undefined, undefined, 'November pay'],
      ['Credit Card Payment', -50000, 'Chase Checking', undefined, true, undefined, undefined, undefined],
      ['Credit Card Payment', 50000, 'Sapphire Card', undefined, true, undefined, undefined, undefined],
      ['Hotel Alba', -14250, 'Sapphire Card', 'Travel', undefined, true, ['lisbon', 'work'], undefined],
      ['Reimbursed dinner', -6000, 'Sapphire Card', undefined, true, undefined, undefined, undefined],
    ]);
  });

  it('does not read meaning into a bank export that happens to have a Type column', () => {
    const file = readCSV(
      'Type,Started Date,Description,Amount,Status\nTRANSFER,2026-01-02,To Sam,-20.00,COMPLETED\nCARD_PAYMENT,2026-01-03,Shop,-5.00,PENDING',
    );
    const mapping = inferMapping(file);
    const { rows } = buildImportRows(file, mapping, inferOptions(file, mapping, 'EUR'));
    expect(rows.map((row) => [row.transfer, row.pending, row.amount])).toEqual([
      [undefined, undefined, -2000],
      [undefined, true, -500],
    ]);
  });
});
