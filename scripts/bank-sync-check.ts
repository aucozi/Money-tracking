/**
 * Proves bank syncing against a real server: SimpleFIN's public demo bank.
 * Claims the demo token, fetches accounts, and merges them twice using the
 * same code the app runs.
 *
 *   npm run check:bank-sync
 *
 * Behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1.
 */
import { addDays } from '../src/domain/dates';
import { accountBalances } from '../src/domain/networth';
import { emptyData } from '../src/domain/seed';
import { SIMPLEFIN_DEMO_TOKEN, SIMPLEFIN_MAX_DAYS } from '../src/domain/sync/simplefin';
import { addConnection, applySync, linkAccounts } from '../src/store/sync';
import { claimAccessUrl, fetchSnapshot } from '../src/sync/client';

const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
};

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const since = addDays(today, -SIMPLEFIN_MAX_DAYS);

  const accessUrl = await claimAccessUrl(SIMPLEFIN_DEMO_TOKEN);
  check('claimed the demo token for an access URL', accessUrl.startsWith('https://'));

  const snapshot = await fetchSnapshot(accessUrl, { startDate: Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000) }, today);
  check('fetched accounts', snapshot.accounts.length >= 2, `${snapshot.accounts.length} accounts`);
  check('no problems reported to the person', snapshot.issues.length === 0, snapshot.issues.map((issue) => issue.message).join('; '));

  let data = addConnection(emptyData('USD'), { id: 'conn', name: 'SimpleFIN Demo', remote: snapshot.accounts }).data;
  data = linkAccounts(data, 'conn', Object.fromEntries(snapshot.accounts.map((account) => [account.remoteId, { kind: 'new' as const }])), snapshot.accounts, today);
  const first = applySync(data, 'conn', snapshot.accounts, { today, since, now: Date.now() });
  const transactions = snapshot.accounts.reduce((total, account) => total + account.transactions.length, 0);
  check('imported every transaction', first.summary.added === transactions, `${first.summary.added} of ${transactions}`);

  const balances = accountBalances(first.data.accounts, first.data.transactions);
  for (const remote of snapshot.accounts) {
    const local = first.data.accounts.find((account) => account.id === first.data.connections[0].links[remote.remoteId]);
    check(`balance of ${remote.name} matches the bank`, local !== undefined && balances.get(local.id) === remote.balance, String(remote.balance / 100));
  }
  check('imported investment holdings', first.data.holdings.length >= 1, first.data.holdings.map((holding) => `${holding.symbol ?? holding.name} ${holding.shares}`).join(', '));

  const again = await fetchSnapshot(accessUrl, { startDate: Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000) }, today);
  const second = applySync(first.data, 'conn', again.accounts, { today, since, now: Date.now() });
  check('a second sync adds no duplicates', second.summary.added === 0 && second.data.transactions.length === first.data.transactions.length, `${second.data.transactions.length} transactions`);
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
