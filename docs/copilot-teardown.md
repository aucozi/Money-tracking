# Copilot Money: what it does, where it falls short, and what Waypoint does instead

This is the research behind Waypoint. It was gathered in November 2026 from public sources only: Copilot's own help
pages, App Store reviews, and third-party reviews. Nothing here comes from inspecting Copilot's code or app binary,
and Waypoint shares no code, name, artwork or layout with it.

**How far to trust the sources.** Several of the reviews are published by competitors or earn affiliate commission, so
their criticism may be shaded; each claim below is tagged with where it came from. Prices differ between sources
($95/year and $13/month in most, $109/year and $18/month in one updated in late October 2026), so check Copilot's site
before relying on a figure. Copilot's public feedback board could not be loaded, so feature requests are cited by title
only.

## What Copilot gets right

These are the parts worth keeping, and Waypoint has an equivalent for each.

| Copilot | Waypoint |
| --- | --- |
| A dashboard that shows spending against the month so far | Home: spending pace against last month and against an even pace, free-to-spend, upcoming bills, net worth, cash flow |
| Categorisation that learns from corrections | Rules created in one tap while categorising, applied to past and future transactions |
| A review inbox for new transactions | "To review" filter with one-tap confirm and "mark all reviewed" |
| Category budgets with optional rollover | The same, plus per-month and from-now-on edits |
| Recurring payment detection | Detection from history, offered as suggestions to confirm |
| A view of subscriptions and what they cost | Subscriptions: monthly and yearly totals, each item's share, and a note when a steady price goes up |
| Swipe actions on transactions | Swipe right to mark reviewed, left to categorise or delete |
| A monthly recap | Month in review, for any month, with the comparison to the month before |
| Net worth across accounts | Net worth with history, assets and debts |
| Split transactions, tags, notes | All three |
| Savings goals | Goals that follow an account balance or are topped up by hand |

## Where it falls short, and the answer in Waypoint

### 1. Apple only

No Android app; the web app arrived in December 2025 and reviewers still list missing pieces (goals, cash flow, split
transactions at various points). A couple where one person uses Android cannot share it.
*Sources: The Penny Hoarder, FinCompareLab, Envelope Budgeting, Copilot's own comparison page.*

**Waypoint:** one React Native codebase. It is built for iPhone first, and the same code runs on Android and in a
browser with every feature present, because nothing depends on an Apple-only API.

### 2. US banks and US dollars only

Copilot's help centre says it only supports US financial institutions. It only supports USD and does not convert
foreign-currency transactions; the original foreign amount is not kept.
*Sources: Borderless Budget (quoting Copilot's help centre), App Store reviews.*

**Waypoint:** any currency per account, a main currency chosen at setup (defaulting to the device's region), and
exchange rates you set yourself. Totals convert through those rates, and an account with no rate is flagged rather than
silently counted one-for-one. A purchase made in another currency can keep its original amount.

### 3. It only works if bank sync works

Manual entry is described as limited, and bank sync is "required for meaningful use". Reviewers report connections
dropping, a bank that needed daily re-syncing, payments landing on the wrong date, and banks that cannot be linked at
all. You cannot enter a transaction before it clears, so there is no projected balance.
*Sources: ToS Watchdog, App Store reviews, JustUseApp reviews.*

**Waypoint:** manual-first. Add a transaction in a few taps, mark it pending, and the balance reflects it immediately.
For bulk entry, import the CSV export every bank offers: columns, date order and decimal style are detected from the
file, raw card descriptors are cleaned into readable names, and rows already on file are skipped, including a pending
charge that reappears with a shifted date. Dates are calendar dates with no timezone, so a transaction cannot drift to
the neighbouring day.

For people who do want it automatic, Waypoint can also connect to a bank: transactions, balances and holdings sync
from the bank service straight to the phone, and anything already entered by hand is matched rather than duplicated.
Coverage and freshness are narrower than Copilot's; see [bank-sync.md](bank-sync.md) and "What Waypoint does not do".

### 4. Your credentials and data pass through third parties

Bank links run through aggregators (Plaid, Finicity), and the data lives on Copilot's servers.
*Sources: ToS Watchdog, The Penny Hoarder.*

**Waypoint:** no account, no Waypoint server, no bank password. Everything is stored on the device. A bank connection
is optional, uses a read-only token you create yourself, and keeps its access key in the device keychain. Backup is a
single readable file you save where you like, and restore validates it before replacing anything.

### 5. Subscription only

No free tier, only a trial that renews unless cancelled, and the price has risen.
*Sources: The Penny Hoarder, FinCompareLab, App Store reviews.*

**Waypoint:** no subscription and nothing to pay for, since there is no service to run.

### 6. A tracker, not a planner

Reviewers describe it as an observation tool: no zero-based budgeting, month-based budgets that are too limited for
cash-flow forecasting, no view of projected income against upcoming bills, and no debt payoff tools.
*Sources: The Penny Hoarder, Envelope Budgeting, FinCompareLab, App Store reviews; Forbes Advisor as summarised in
search results (the page itself could not be read).*

**Waypoint:**
- **Zero-based mode.** Switch the Budget tab to "plan every dollar" and it shows income left to assign.
- **Forecast.** A day-by-day projection of cash for 30, 60 or 90 days from tracked bills and income, optionally
  including typical everyday spending, with the lowest point and a warning if it goes below zero. Overdue bills are
  assumed to be paid today; late income is not counted on.
- **Free to spend.** Budget, minus spending so far, minus bills still due this month, as a per-day figure.
- **Debt payoff planner.** Highest-rate-first or smallest-first, with the effect of paying extra each month.

### 7. Rules you cannot see or edit

A reviewer reports having to contact support to remove a rule, with no timeline for a fix. Transaction names cannot be
cleaned up automatically.
*Sources: App Store reviews, JustUseApp reviews.*

**Waypoint:** a rules screen listing every rule in plain language, with enable, reorder, edit and delete. Rules can
match on payee text, amount range, direction and account, and can set a category, rename the payee, add tags, mark as
transfer or mark as reviewed. A rule shows how many existing transactions it matches before you save it.

### 8. Changing a budget rewrites history

A feature request is titled "Increase budget for category with rollover enabled without affecting past months".
*Source: Copilot feedback board, title only.*

**Waypoint:** budgets are stored with the month they start from. An edit applies either to this month only or from
this month on, and earlier months always keep the amounts they had, so past results and carried-over balances never
change under you.

### 9. Annual and irregular costs fit badly into monthly budgets

Requests include "Spread a transaction over a period of time", and reviewers mention bills that cannot be set up
flexibly.
*Sources: Copilot feedback board (title only), App Store and JustUseApp reviews.*

**Waypoint:** a transaction can be counted evenly over 2 to 12 months of budget without a cent lost to rounding.
Recurring items can be weekly, fortnightly, monthly, quarterly or yearly, can be added by hand with their due date, and
show the monthly amount to set aside. A due date can be marked paid or skipped in two taps.

### 10. You cannot export what you are looking at

A reviewer who needed transactions for a date range had to export everything and filter in a spreadsheet.
*Source: App Store reviews.*

**Waypoint:** the export button on the Transactions tab exports exactly the filtered list. Cells that a spreadsheet
would run as a formula are neutralised.

### 11. Setup is heavy and the numbers are not always explained

Reviewers mention an hour spent re-sorting categories, too many overlapping categories, wanting category groups, income
that cannot be categorised, and an unexplained "-999%".
*Source: JustUseApp reviews.*

**Waypoint:** 17 starting categories in four groups, income categories included, bulk select-and-categorise, and
budgets suggested from your own recent averages. When there is nothing to compare a figure against, the app says so in
words instead of showing a meaningless percentage.

## What Waypoint does not do

Stated plainly, so nobody is surprised:

- **Bank sync is narrower than Copilot's.** It covers the United States and Canada through SimpleFIN, refreshes about
  once a day rather than within minutes, and cannot send a notification the moment a card is charged. Everywhere
  else, transactions arrive by hand or by CSV import.
- **Investments are simpler.** Holdings show value and gain since purchase. There is no performance chart over time,
  no benchmark comparison, and holdings entered by hand are not priced automatically.
- **No shared household.** There is no server, so two phones cannot share one dataset. One reviewer reports that
  Copilot has announced a household feature; Waypoint has no equivalent. A backup file can be moved between devices
  by hand.
- **No automatic backup or sync between devices.** Losing the phone without a saved backup loses the data.
- **No Apple Watch app, widgets or Siri shortcuts**, no AI assistant, no credit score.

## Sources

- The Penny Hoarder, "Copilot Money Review 2026": https://www.thepennyhoarder.com/budgeting/budgeting-copilot-money-review/
- Borderless Budget, "Copilot Money Review 2026: USD-Only, No Multi-Currency": https://borderlessbudget.com/blog/copilot-money-review-expats
- FinCompareLab, "Copilot Money Review": https://www.fincomparelab.com/reviews/copilot-money-review/
- Envelope Budgeting, "Copilot Money Review & Best Alternatives": https://envelopebudgeting.com/articles/copilot-money-review
- ToS Watchdog, Copilot: https://terms.law/ToS-Watchdog/budgeting-apps/copilot/
- App Store ratings and reviews: https://apps.apple.com/us/app/id1447330651?see-all=reviews
- JustUseApp review aggregator: https://justuseapp.com/en/app/1447330651/copilot-the-smart-money-app/reviews
- Copilot help centre, budget rollovers: https://help.copilot.money/en/articles/3790828-budget-rollovers
- Copilot, "Copilot vs YNAB": https://www.copilot.money/compare/ynab
- Forbes Advisor, "Copilot Money Budget App Review" (search summary only): https://www.forbes.com/advisor/banking/copilot-budget-app-review/
