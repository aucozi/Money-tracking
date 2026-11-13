# Automatic bank and investment updates

Waypoint can bring in transactions, balances and investment holdings by itself. This page explains how it works, what
it needs from you, where its limits are, and what the other routes would take.

## What is built

Waypoint speaks [SimpleFIN](https://www.simplefin.org/protocol.html), an open standard for sharing read-only bank data.

1. You create a token at SimpleFIN Bridge and paste it into **Accounts → Bank connections**.
2. Waypoint exchanges it once for an access key and stores that key in the device keychain.
3. You choose which bank accounts to follow. Each can start a new account in Waypoint or continue one you already have.
4. From then on Waypoint fetches straight from the SimpleFIN server whenever you open the app (at most every four hours)
   and whenever you pull down to refresh on Home or Accounts.

There is no Waypoint server in between and no developer key: the phone talks to SimpleFIN directly with your own token.
The connection is read-only. It can see balances and transactions; it cannot move money.

What arrives:

- **Transactions**, new ones marked "to review", with readable names and the bank's original text kept alongside.
  Your rules and bill matching run on them as they arrive.
- **Balances**, which Waypoint matches to the cent on every sync.
- **Holdings** for investment accounts: shares, current value and, where the bank provides it, what you paid.

How it merges with what you already have:

- The bank decides amounts, dates, pending or cleared, and balances.
- You decide names, categories, notes, tags and splits. A sync never overwrites those.
- A transaction you entered by hand, or imported from a CSV, is recognised and linked instead of duplicated.
- A pending charge is followed when it clears, including when it posts under a new id with a tip added, and is removed
  if the bank drops it.

You can try all of this without an account: **Bank connections → Try it with a demo bank** connects to SimpleFIN's
public demo. `npm run check:bank-sync` runs the same code against that server from the command line.

## What you need

- **A SimpleFIN Bridge account.** It is a paid service run by SimpleFIN, not by Waypoint.
- **A bank it covers.** SimpleFIN Bridge connects to banks in the United States and Canada.

## The limits

- **Daily, not instant.** Banks refresh through SimpleFIN about once a day, so a purchase appears the next day, not
  the next minute. Entering it by hand in the meantime is fine: the sync will match it.
- **About 45 days of history** on the first sync. Import a CSV for anything older.
- **United States and Canada only**, because that is what SimpleFIN Bridge covers.
- **Holdings follow the bank.** Prices update when the brokerage syncs. A holding you add by hand keeps the value you
  type; Waypoint does not fetch market prices itself.
- **No investment performance history or benchmarks.** It shows value and gain since purchase, not a chart over time.
- **Connections are per device.** The access key is not in backups, so after restoring a backup you connect again.

## The other routes, and what each would take

| Route | Coverage | What it needs |
| --- | --- | --- |
| **SimpleFIN** (built) | US, Canada | Your own SimpleFIN token. Nothing else. |
| **Plaid** | US, Canada, UK, parts of Europe | A server to hold Plaid's secret key (it must not ship inside an app), Plaid approving the app for production access, and Plaid's native sign-in screen, which means a custom build rather than Expo Go. This is what Copilot uses. |
| **Enable Banking** | Europe, UK | Reported to have a free tier for linking your own accounts. Needs an adapter that signs requests with a private key, and each bank's consent expires and has to be renewed, typically every 90 to 180 days. |
| **GoCardless Bank Account Data** | Europe, UK | Reported closed to new sign-ups, so only usable if you already have keys. |

## What it costs

Figures gathered in November 2026 from public pages and third-party write-ups. Check each provider before relying on
them: Plaid in particular publishes no price list.

| Service | Cost | Who pays |
| --- | --- | --- |
| **SimpleFIN Bridge** (what Waypoint uses) | $1.50 a month or $15 a year, for up to 25 institutions | You, directly to SimpleFIN. Nothing to Waypoint, and no developer account or server. |
| **Plaid** | Not published. Third-party estimates put it around $0.25 to $0.60 per connected account per month for transactions, with reported contracts in the thousands of dollars a year. | The app's developer, who also has to run a server and pass Plaid's production review. |
| **Enable Banking** | Reported free for linking your own accounts. | Nobody, for personal use. The cost is the work of building and maintaining the adapter. |
| **Apple FinanceKit** | Apple Card, Apple Cash, Savings | Real-time and entirely on the phone, but Apple has to grant the app an entitlement, and it needs a native module and a custom build. |

Push notifications the moment a card is charged, as Copilot has, need a server listening for the bank's notifications.
That is the one thing a phone-only design cannot do.

## Adding another service

The merge logic does not know about SimpleFIN. A new service needs one thing: a function that turns its response into a
`RemoteSnapshot` (`src/domain/sync/types.ts`), the same shape `parseAccountSet` produces in
`src/domain/sync/simplefin.ts`. Everything after that, matching, deduplication, balances, holdings, is shared in
`src/store/sync.ts`.
