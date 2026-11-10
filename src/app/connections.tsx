import * as Linking from 'expo-linking';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatAgo, todayISO } from '@/domain/dates';
import { SIMPLEFIN_CREATE_URL, SIMPLEFIN_DEMO_TOKEN, SimpleFinError } from '@/domain/sync/simplefin';
import type { RemoteAccount } from '@/domain/sync/types';
import type { Connection } from '@/domain/types';
import { useData, useNow } from '@/store/hooks';
import { useStore } from '@/store/store';
import type { LinkChoice } from '@/store/sync';
import { connect, disconnect, syncConnection, useSync } from '@/sync/run';
import { Sheet, useConfirm, useToast } from '@/ui/overlays';
import { OptionField } from '@/ui/pickers';
import { Button, Card, Field, Notice, Pill, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { space } from '@/ui/theme';

const NEW = 'new';
const SKIP = 'skip';

/** What the connection last offered, in the shape linking needs. */
function offeredBy(connection: Connection, live: RemoteAccount[] | undefined): RemoteAccount[] {
  if (live?.length) return live;
  return connection.remoteAccounts.map((account) => ({
    remoteId: account.id,
    name: account.name,
    institution: account.institution,
    currency: account.currency,
    balance: 0,
    balanceDate: todayISO(),
    transactions: [],
  }));
}

export default function ConnectionsScreen() {
  const data = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const offered = useSync((state) => state.offered);
  const linkAccounts = useStore((state) => state.linkAccounts);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const now = useNow();

  const linkingConnection = data.connections.find((connection) => connection.id === linking);
  const linkingAccounts = linkingConnection ? offeredBy(linkingConnection, offered[linkingConnection.id]) : [];

  const openLinking = (connection: Connection) => {
    const accounts = offeredBy(connection, offered[connection.id]);
    // Follow everything by default the first time; afterwards show what is followed now.
    const fresh = Object.keys(connection.links).length === 0;
    setChoices(Object.fromEntries(accounts.map((account) => [account.remoteId, connection.links[account.remoteId] ?? (fresh ? NEW : SKIP)])));
    setLinking(connection.id);
  };

  const start = async (value: string) => {
    setProblem(null);
    setBusy('connect');
    try {
      const { connectionId } = await connect(value);
      setToken('');
      const connection = useStore.getState().data.connections.find((item) => item.id === connectionId);
      if (connection) openLinking(connection);
    } catch (error) {
      setProblem(error instanceof SimpleFinError ? error.message : 'Could not connect. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  };

  const run = async (connectionId: string) => {
    setBusy(connectionId);
    const outcome = await syncConnection(connectionId);
    setBusy(null);
    if ('error' in outcome) toast('Could not sync');
    else if (outcome.added + outcome.updated + outcome.removed === 0) toast('Already up to date');
    else toast(`${outcome.added} new ${outcome.added === 1 ? 'transaction' : 'transactions'}${outcome.updated ? `, ${outcome.updated} updated` : ''}`);
  };

  const saveLinks = async () => {
    if (!linkingConnection) return;
    const mapped: Record<string, LinkChoice> = Object.fromEntries(
      Object.entries(choices).map(([remoteId, value]) => [
        remoteId,
        value === NEW ? { kind: 'new' } : value === SKIP ? { kind: 'skip' } : { kind: 'existing', accountId: value },
      ]),
    );
    linkAccounts(linkingConnection.id, mapped, linkingAccounts, todayISO());
    const id = linkingConnection.id;
    setLinking(null);
    if (Object.values(mapped).some((choice) => choice.kind !== 'skip')) await run(id);
  };

  const remove = async (connection: Connection) => {
    const ok = await confirm({
      title: `Disconnect ${connection.name}?`,
      message: 'Its accounts and their transactions stay in Waypoint; they just stop updating. The saved access is erased from this device.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    await disconnect(connection.id);
    toast('Disconnected');
  };

  return (
    <Screen edges={['bottom']} testID="connections-screen">
      <T tone="muted">
        Connect a bank and its transactions, balances and investments arrive by themselves. Waypoint talks to the connection service straight from this device,
        and the access key is kept in the device keychain, not in your data or backups.
      </T>

      {data.connections.map((connection) => {
        const followed = Object.keys(connection.links).length;
        return (
          <Card key={connection.id}>
            <Row>
              <T variant="heading" style={styles.flex}>
                {connection.name}
              </T>
              <Pill
                label={connection.lastError ? 'Needs attention' : connection.lastSyncedAt ? 'Up to date' : followed ? 'Not synced yet' : 'Choose accounts'}
                tone={connection.lastError ? 'warning' : connection.lastSyncedAt ? 'positive' : 'muted'}
              />
            </Row>
            <T variant="label" tone="muted" testID={`connection-status-${connection.id}`}>
              {followed} of {Math.max(followed, connection.remoteAccounts.length)} {connection.remoteAccounts.length === 1 ? 'account' : 'accounts'} followed
              {connection.lastSyncedAt ? ` · synced ${formatAgo(connection.lastSyncedAt, now)}` : ''}
            </T>
            {connection.lastError ? <Notice tone="warning" title="Last sync" body={connection.lastError} /> : null}
            <Row style={styles.wrap}>
              <Button
                label={busy === connection.id ? 'Syncing…' : 'Sync now'}
                icon="refresh"
                small
                onPress={() => run(connection.id)}
                disabled={busy !== null || followed === 0}
                testID="sync-now"
              />
              <Button label="Accounts" kind="secondary" small onPress={() => openLinking(connection)} testID="choose-accounts" />
              <Button label="Disconnect" kind="danger" small onPress={() => remove(connection)} testID="disconnect" />
            </Row>
          </Card>
        );
      })}

      <SectionTitle>{data.connections.length > 0 ? 'Connect another bank' : 'Connect a bank'}</SectionTitle>
      <Card>
        <T variant="label" tone="muted">
          Waypoint uses SimpleFIN, an open standard for sharing read-only bank data. You create a token there, paste it here once, and that is the only thing
          Waypoint ever holds. It can read balances and transactions; it cannot move money.
        </T>
        <Button label="1 · Create a token at SimpleFIN" kind="secondary" icon="open-outline" onPress={() => void Linking.openURL(SIMPLEFIN_CREATE_URL)} />
        <Field
          label="2 · Paste the token"
          value={token}
          onChangeText={setToken}
          placeholder="aHR0cHM6Ly9…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          testID="token-input"
        />
        {problem ? <Notice tone="negative" title="Could not connect" body={problem} /> : null}
        <Button
          label={busy === 'connect' ? 'Connecting…' : 'Connect'}
          onPress={() => start(token)}
          disabled={!token.trim() || busy !== null}
          testID="connect-button"
        />
        <Button label="Try it with a demo bank" kind="ghost" onPress={() => start(SIMPLEFIN_DEMO_TOKEN)} disabled={busy !== null} testID="connect-demo" />
        <T variant="caption" tone="faint">
          SimpleFIN Bridge covers banks in the United States and Canada and charges its own small subscription. Banks refresh about once a day, so Waypoint
          checks when you open it and whenever you pull down to refresh.
        </T>
      </Card>

      <Sheet
        visible={linkingConnection !== undefined}
        onClose={() => setLinking(null)}
        title="Which accounts to follow"
        testID="link-sheet"
        footer={<Button label="Save and sync" onPress={saveLinks} testID="save-links" />}
      >
        <T variant="label" tone="muted">
          Each bank account can start a new account in Waypoint or continue one you already have. Transactions you entered by hand are matched, not duplicated.
        </T>
        {linkingAccounts.map((account) => {
          const linkedElsewhere = new Set(
            data.connections.flatMap((connection) =>
              Object.entries(connection.links)
                .filter(([remoteId]) => !(connection.id === linking && remoteId === account.remoteId))
                .map(([, accountId]) => accountId),
            ),
          );
          const existing = data.accounts.filter((item) => !item.archived && item.currency === account.currency && !linkedElsewhere.has(item.id));
          return (
            <View key={account.remoteId}>
              <OptionField
                label={`${account.name}${account.institution ? ` · ${account.institution}` : ''}`}
                value={choices[account.remoteId] ?? SKIP}
                onChange={(value) => setChoices({ ...choices, [account.remoteId]: value })}
                options={[
                  { value: NEW, label: 'Add as a new account' },
                  ...existing.map((item) => ({ value: item.id, label: `Continue "${item.name}"` })),
                  { value: SKIP, label: 'Do not follow' },
                ]}
                testID={`link-${account.remoteId}`}
              />
            </View>
          );
        })}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap', gap: space.sm },
});
