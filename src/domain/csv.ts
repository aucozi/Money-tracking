import { detectDateOrder, parseFlexibleDate, type DateOrder } from './dates';
import { parseAmount } from './money';
import { cleanPayee } from './rules';
import type { CurrencyCode, ISODate } from './types';

const DELIMITERS = [',', ';', '\t', '|'] as const;

/** Pick the delimiter that splits the first lines into the most consistent columns. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12);
  let best = ',';
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => parseLine(line, delimiter).length);
    const typical = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    if (typical < 2) continue;
    const consistent = counts.filter((count) => count === typical).length;
    const score = consistent * 100 + typical;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function parseLine(line: string, delimiter: string): string[] {
  return parseCSV(line, delimiter)[0] ?? [];
}

interface ParsedRow {
  cells: string[];
  /** 1-based line of the file on which the row starts. */
  line: number;
}

function parseRows(text: string, delimiter: string): ParsedRow[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: ParsedRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== '') rows.push({ cells: row.map((cell) => cell.trim()), line: rowLine });
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted && field.trim() === '') {
      quoted = true;
      fieldStarted = true;
      field = '';
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, and line breaks inside
 * quotes. Tolerates a byte-order mark and CRLF, LF or CR line endings.
 * Blank lines are dropped.
 */
export function parseCSV(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  return parseRows(text, delimiter).map((row) => row.cells);
}

export interface CsvFile {
  headers: string[];
  rows: string[][];
  /** For each data row, the 1-based line of the file it starts on, for error messages. */
  lines: number[];
}

export type Field = 'date' | 'payee' | 'amount' | 'debit' | 'credit' | 'category' | 'notes' | 'currency';

const SYNONYMS: Record<Field, string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'post date', 'completed date', 'started date', 'booking date', 'value date', 'trans date', 'datum', 'data', 'fecha', 'buchungstag', 'valuta', 'data operacji', 'date operation'],
  payee: ['description', 'payee', 'merchant', 'name', 'details', 'transaction details', 'narrative', 'counterparty', 'beneficiary', 'beneficiary name', 'title', 'reference', 'text', 'aprasymas', 'gavejas', 'moketojas', 'beschreibung', 'verwendungszweck', 'empfanger', 'concepto', 'descripcion', 'libelle', 'opis', 'omschrijving'],
  amount: ['amount', 'sum', 'value', 'total', 'transaction amount', 'amount (eur)', 'amount (usd)', 'amount (gbp)', 'suma', 'betrag', 'importe', 'montant', 'kwota', 'bedrag', 'belopp'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'outflow', 'spent', 'debit amount', 'soll', 'cargo'],
  credit: ['credit', 'deposit', 'deposits', 'paid in', 'money in', 'inflow', 'received', 'credit amount', 'haben', 'abono'],
  category: ['category', 'kategorie', 'categoria', 'kategorija', 'categorie'],
  notes: ['notes', 'note', 'memo', 'comment', 'comments', 'message', 'pastabos'],
  currency: ['currency', 'ccy', 'valiuta', 'wahrung', 'moneda', 'devise', 'waluta'],
};

function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldFor(header: string): Field | null {
  const name = normaliseHeader(header);
  if (!name) return null;
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    if (SYNONYMS[field].includes(name)) return field;
  }
  // Looser match for things like "Amount in EUR" or "Transaction description".
  for (const field of ['debit', 'credit', 'amount', 'date', 'payee', 'category', 'currency', 'notes'] as Field[]) {
    if (SYNONYMS[field].some((word) => word.length >= 4 && new RegExp(`\\b${word}\\b`).test(name))) return field;
  }
  return null;
}

/**
 * Split a file into header and data rows. Bank exports often start with a few
 * lines of account details, so the header is the first row that looks like one.
 */
export function readCSV(text: string): CsvFile {
  const all = parseRows(text, detectDelimiter(text));
  if (all.length === 0) return { headers: [], rows: [], lines: [] };
  const width = Math.max(...all.map((row) => row.cells.length));

  let headerIndex = -1;
  for (let i = 0; i < Math.min(all.length, 15); i += 1) {
    const recognised = all[i].cells.filter((cell) => fieldFor(cell)).length;
    if (recognised >= 2) {
      headerIndex = i;
      break;
    }
  }

  const pad = (row: string[]) => (row.length < width ? [...row, ...new Array(width - row.length).fill('')] : row);
  const data = all.slice(headerIndex + 1);
  return {
    headers:
      headerIndex === -1
        ? Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
        : pad(all[headerIndex].cells).map((cell, i) => cell || `Column ${i + 1}`),
    rows: data.map((row) => pad(row.cells)),
    lines: data.map((row) => row.line),
  };
}

export type ColumnMapping = Partial<Record<Field, number>>;

/** Guess which column holds what, from the header names and then from the data itself. */
export function inferMapping(file: CsvFile): ColumnMapping {
  const mapping: ColumnMapping = {};
  file.headers.forEach((header, index) => {
    const field = fieldFor(header);
    if (field && mapping[field] === undefined) mapping[field] = index;
  });

  const sample = file.rows.slice(0, 25);
  const used = () => new Set(Object.values(mapping));
  const columnScore = (index: number, test: (cell: string) => boolean) =>
    sample.length === 0 ? 0 : sample.filter((row) => test(row[index] ?? '')).length / sample.length;
  const width = file.headers.length;

  if (mapping.date === undefined) {
    for (let i = 0; i < width; i += 1) {
      if (!used().has(i) && columnScore(i, (cell) => parseFlexibleDate(cell, 'DMY') !== null || parseFlexibleDate(cell, 'MDY') !== null) > 0.8) {
        mapping.date = i;
        break;
      }
    }
  }
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    for (let i = width - 1; i >= 0; i -= 1) {
      if (used().has(i)) continue;
      if (columnScore(i, (cell) => /\d/.test(cell) && /^[\s\d.,()+\-−€$£¥A-Za-z]+$/.test(cell) && !/[A-Za-z]{4,}/.test(cell)) > 0.8) {
        mapping.amount = i;
        break;
      }
    }
  }
  if (mapping.payee === undefined) {
    let best = -1;
    let bestLength = 0;
    for (let i = 0; i < width; i += 1) {
      if (used().has(i)) continue;
      const letters = sample.reduce((total, row) => total + (row[i] ?? '').replace(/[^A-Za-z]/g, '').length, 0);
      if (letters > bestLength) {
        bestLength = letters;
        best = i;
      }
    }
    if (best >= 0) mapping.payee = best;
  }
  return mapping;
}

/** ',' when the column writes decimals with a comma, '.' with a point, 'auto' when it cannot tell. */
export function detectDecimal(samples: readonly string[]): '.' | ',' | 'auto' {
  let comma = 0;
  let dot = 0;
  for (const sample of samples) {
    const digits = sample.replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(digits)) comma += 1;
    if (/\.\d{1,2}$/.test(digits)) dot += 1;
  }
  if (comma > 0 && dot === 0) return ',';
  if (dot > 0 && comma === 0) return '.';
  return 'auto';
}

export interface ImportOptions {
  currency: CurrencyCode;
  dateOrder: DateOrder;
  decimal: '.' | ',' | 'auto';
  /** For exports that list purchases as positive numbers (many credit cards do). */
  flipSign: boolean;
}

export interface ImportRow {
  line: number;
  date: ISODate;
  amount: number;
  payee: string;
  rawPayee: string;
  categoryName?: string;
  notes?: string;
  currency?: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: { line: number; reason: string }[];
}

/** Sensible import settings for a file, worked out from its own contents. */
export function inferOptions(file: CsvFile, mapping: ColumnMapping, currency: CurrencyCode, fallbackOrder: DateOrder = 'MDY'): ImportOptions {
  const column = (index: number | undefined) => (index === undefined ? [] : file.rows.map((row) => row[index] ?? ''));
  const amounts = [...column(mapping.amount), ...column(mapping.debit), ...column(mapping.credit)].filter(Boolean);
  return {
    currency,
    dateOrder: detectDateOrder(column(mapping.date), fallbackOrder),
    decimal: detectDecimal(amounts),
    flipSign: false,
  };
}

/** Turn mapped CSV rows into transactions-to-be, collecting rows that cannot be read. */
export function buildImportRows(file: CsvFile, mapping: ColumnMapping, options: ImportOptions): ImportResult {
  const result: ImportResult = { rows: [], errors: [] };
  if (mapping.date === undefined) {
    result.errors.push({ line: 0, reason: 'Choose which column holds the date.' });
    return result;
  }
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    result.errors.push({ line: 0, reason: 'Choose which column holds the amount.' });
    return result;
  }

  file.rows.forEach((row, index) => {
    const line = file.lines[index] ?? index + 1;
    const cell = (column: number | undefined) => (column === undefined ? '' : (row[column] ?? '').trim());
    if (row.every((value) => value.trim() === '')) return;

    const date = parseFlexibleDate(cell(mapping.date), options.dateOrder);
    if (!date) {
      result.errors.push({ line, reason: `Could not read the date "${cell(mapping.date)}".` });
      return;
    }

    let amount: number | null;
    if (mapping.amount !== undefined && cell(mapping.amount) !== '') {
      amount = parseAmount(cell(mapping.amount), options.currency, { decimal: options.decimal });
    } else if (mapping.debit !== undefined || mapping.credit !== undefined) {
      const debit = parseAmount(cell(mapping.debit), options.currency, { decimal: options.decimal });
      const credit = parseAmount(cell(mapping.credit), options.currency, { decimal: options.decimal });
      amount = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    } else {
      amount = null;
    }
    if (amount === null) {
      result.errors.push({ line, reason: 'Could not read the amount.' });
      return;
    }
    if (amount === 0) return; // zero rows are balance markers or holds, not money moving
    if (options.flipSign) amount = -amount;

    const rawPayee = cell(mapping.payee).replace(/\s+/g, ' ');
    result.rows.push({
      line,
      date,
      amount,
      rawPayee,
      payee: cleanPayee(rawPayee) || 'Unknown',
      categoryName: cell(mapping.category) || undefined,
      notes: cell(mapping.notes) || undefined,
      currency: cell(mapping.currency).toUpperCase() || undefined,
    });
  });
  return result;
}

/**
 * Serialise rows as CSV. Text that a spreadsheet would run as a formula is
 * prefixed with an apostrophe, so an exported payee can never execute anything.
 */
export function toCSV(rows: readonly (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          if (typeof value === 'number') return String(value);
          let text = value;
          if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+([.,]\d+)?$/.test(text)) text = `'${text}`;
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\r\n');
}
