/** The record of the emails a paid order owes: one row per order and
 * audience in devine_order_notices, with its own key, how many attempts it
 * has had, when, what the last failure said, and the provider's identifiers
 * once a send is accepted.
 *
 * WHY THE KEY IS OURS. DeVine's mail provider is SMTP through nodemailer, a
 * mailbox the shop owns, not a hosted API. SMTP has no idempotency key and
 * no message lookup: the server either answers 250 with a queue id or it
 * does not, and a lost answer looks exactly like a refused send. So the key
 * here is ours. It names the order and the audience, it never changes, it
 * becomes the Message-ID header on every attempt for that notice, and the
 * row is written BEFORE the socket is opened. That buys the two things a
 * hosted retry key would have bought: a send whose answer was lost is
 * visible afterwards (the row is still 'sending' and is read back as
 * 'unconfirmed'), and a resend of it carries the identical Message-ID, which
 * is what mail clients and servers thread and deduplicate on.
 *
 * What it cannot do is promise the shop never sees two copies. So nothing
 * resends an unconfirmed notice on its own: recovery skips it, the board
 * says plainly that it may already have gone out, and only the owner can ask
 * for it again. A second copy of a receipt is a nuisance; a second charge is
 * not possible from here at all, because nothing in this file touches money.
 *
 * No I/O of its own: the caller passes the pool or client, which is how the
 * tests run it on PGlite.
 */
import 'server-only';

export type NoticeAudience = 'shop' | 'customer';
/** sending: an attempt is open. sent: the provider took it. failed: the
 * provider refused it. unconfirmed: an attempt was left open, so it may or
 * may not have gone out. unconfigured: no mailbox is set up here.
 * not-needed: there is no address to send to, which is settled, not owed. */
export type NoticeState = 'pending' | 'sending' | 'sent' | 'failed' | 'unconfirmed' | 'unconfigured' | 'not-needed';
export type NoticeRow = {
  key: string; attemptKey: string; orderNumber: string; audience: NoticeAudience;
  state: NoticeState; messageId: string; providerMessageId: string | null;
  providerResponse: string | null; attempts: number; lastError: string | null;
  createdAt: number; updatedAt: number;
};
/** The send outcome as intake.ts reports it, kept here so the state machine
 * and the mail code agree on the vocabulary. */
export type NoticeSend = {
  outcome: 'sent' | 'send-failed' | 'unconfigured' | 'not-needed';
  providerMessageId: string | null; providerResponse: string | null; error: string | null;
};

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
type Database = { query: Query; connect: () => Promise<{ query: Query; release: () => void }> };

export const NOTICE_SCHEMA = `CREATE TABLE IF NOT EXISTS devine_order_notices (
 notice_key text PRIMARY KEY, attempt_key text NOT NULL, order_number text NOT NULL,
 audience text NOT NULL, state text NOT NULL, message_id text NOT NULL,
 provider_message_id text, provider_response text, attempts integer NOT NULL DEFAULT 0,
 last_error text, created_at bigint NOT NULL, updated_at bigint NOT NULL);
 CREATE INDEX IF NOT EXISTS devine_order_notice_attempt ON devine_order_notices (attempt_key);`;

/** Stable for the life of the order. The board order id, not the payment
 * attempt key: a customer who is declined and pays again is a new order id
 * and so a genuinely new notice, while a retried request on one order is
 * always the same notice. */
export const noticeKey = (orderId: string, audience: NoticeAudience) => `notice:${orderId}:${audience}`;

const readRow = (row: Record<string, unknown>): NoticeRow => ({
  key: String(row.notice_key), attemptKey: String(row.attempt_key), orderNumber: String(row.order_number),
  audience: row.audience === 'customer' ? 'customer' : 'shop', state: row.state as NoticeState,
  messageId: String(row.message_id), providerMessageId: (row.provider_message_id as string) ?? null,
  providerResponse: (row.provider_response as string) ?? null, attempts: Number(row.attempts),
  lastError: (row.last_error as string) ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
});

const SETTLED: NoticeState[] = ['sent', 'not-needed'];

/**
 * Open one attempt, or refuse to. Returns the Message-ID to send under, or
 * null when this notice must not be sent right now. The row is written
 * inside the transaction that reads it, so the attempt exists in storage
 * before any mail server is contacted; a storage outage here means no send
 * happened at all, which is the safe direction.
 *
 * `force` is the owner's explicit resend and is the ONLY way an unconfirmed
 * notice is sent again.
 */
export async function beginNotice(
  db: Database,
  input: { key: string; attemptKey: string; orderNumber: string; audience: NoticeAudience; messageId: string; force?: boolean },
  now = Date.now(),
): Promise<{ messageId: string; attempts: number } | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO devine_order_notices(notice_key,attempt_key,order_number,audience,state,message_id,attempts,created_at,updated_at)
       VALUES($1,$2,$3,$4,'pending',$5,0,$6,$6) ON CONFLICT DO NOTHING`,
      [input.key, input.attemptKey, input.orderNumber, input.audience, input.messageId, now],
    );
    const found = await client.query('SELECT * FROM devine_order_notices WHERE notice_key=$1 FOR UPDATE', [input.key]);
    const row = readRow(found.rows[0]);
    // An attempt still marked sending never reported back. Say so in storage
    // before deciding anything, so the board stops calling it in flight.
    const state: NoticeState = row.state === 'sending' ? 'unconfirmed' : row.state;
    if (state !== row.state) {
      await client.query('UPDATE devine_order_notices SET state=$2,updated_at=$3 WHERE notice_key=$1', [input.key, state, now]);
    }
    if (SETTLED.includes(state) || (state === 'unconfirmed' && !input.force)) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE devine_order_notices SET state='sending',attempts=attempts+1,last_error=NULL,updated_at=$2 WHERE notice_key=$1`,
      [input.key, now],
    );
    await client.query('COMMIT');
    return { messageId: row.messageId, attempts: row.attempts + 1 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Close the attempt this caller opened. Guarded on 'sending' so a result
 * that arrives after someone else took the row over cannot overwrite it. */
export async function finishNotice(db: Database, key: string, result: NoticeSend, now = Date.now()): Promise<void> {
  const state: NoticeState =
    result.outcome === 'sent' ? 'sent' : result.outcome === 'not-needed' ? 'not-needed' : result.outcome === 'unconfigured' ? 'unconfigured' : 'failed';
  await db.query(
    `UPDATE devine_order_notices SET state=$2,
     provider_message_id=COALESCE($3,provider_message_id),provider_response=COALESCE($4,provider_response),
     last_error=$5,updated_at=$6 WHERE notice_key=$1 AND state='sending'`,
    [key, state, result.providerMessageId, result.providerResponse, result.error, now],
  );
}

/** Every notice belonging to the payment attempts the board is showing.
 * Listed by attempt so the owner reads one story per order instead of two
 * screens that have to be matched up by hand. */
export async function noticesForAttempts(db: Database, attemptKeys: string[]): Promise<NoticeRow[]> {
  if (attemptKeys.length === 0) return [];
  const slots = attemptKeys.map((_, i) => `$${i + 1}`).join(',');
  const rows = await db.query(
    `SELECT * FROM devine_order_notices WHERE attempt_key IN (${slots}) ORDER BY created_at ASC,audience ASC`,
    attemptKeys,
  );
  return rows.rows.map(readRow);
}

/** Owner-facing wording for the board. Plain, and never claims delivery the
 * mail server did not confirm. */
export function noticeWording(row: NoticeRow): string {
  const who = row.audience === 'shop' ? 'Shop ticket' : 'Customer receipt';
  const said: Record<NoticeState, string> = {
    pending: 'not sent yet',
    sending: 'a send is running',
    sent: 'sent',
    failed: 'not sent',
    unconfirmed: 'the mail server never answered, so this may or may not have gone out',
    unconfigured: 'not sent: no mailbox is set up here',
    'not-needed': 'no email address on this order, so there is nothing to send',
  };
  return `${who}: ${said[row.state]}`;
}
