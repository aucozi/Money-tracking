import { accountsUrl, claimUrlFromToken, parseAccessUrl, parseAccountSet, SimpleFinError, type AccountsQuery } from '@/domain/sync/simplefin';
import type { RemoteSnapshot } from '@/domain/sync/types';
import type { ISODate } from '@/domain/types';

type Fetch = typeof fetch;

async function request(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new SimpleFinError('Could not reach the bank connection. Check that you are online and try again.');
  }
}

/**
 * Exchange a setup token for the access URL. A token works once: if this fails
 * with "already used", someone else may have claimed it, and the person should
 * disable that token.
 */
export async function claimAccessUrl(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const response = await request(fetchImpl, claimUrlFromToken(token), { method: 'POST', headers: { 'Content-Length': '0' } });
  if (response.status === 403) {
    throw new SimpleFinError(
      'This token has already been used or does not exist. If you did not use it yourself, disable it in SimpleFIN, then create a new one.',
    );
  }
  if (!response.ok) throw new SimpleFinError(`The token could not be claimed (error ${response.status}). Create a new one and try again.`);
  const accessUrl = (await response.text()).trim();
  parseAccessUrl(accessUrl); // throws unless it is an https URL with credentials
  return accessUrl;
}

/** Fetch accounts, balances, transactions and holdings from a SimpleFIN server. */
export async function fetchSnapshot(accessUrl: string, query: AccountsQuery, today: ISODate, fetchImpl: Fetch = fetch): Promise<RemoteSnapshot> {
  const access = parseAccessUrl(accessUrl);
  const response = await request(fetchImpl, accountsUrl(access, query), {
    method: 'GET',
    headers: { Authorization: access.authorization, Accept: 'application/json' },
  });
  if (response.status === 403)
    throw new SimpleFinError('The bank connection no longer accepts this app. Access may have been revoked: connect again with a new token.');
  if (response.status === 402) throw new SimpleFinError('The SimpleFIN subscription for this connection has lapsed. Renew it to keep syncing.');
  if (!response.ok) throw new SimpleFinError(`The bank connection is not answering properly (error ${response.status}). Try again later.`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SimpleFinError('The bank connection sent a reply that could not be read. Try again later.');
  }
  return parseAccountSet(payload, today);
}
