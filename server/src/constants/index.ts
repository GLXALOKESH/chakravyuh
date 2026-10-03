/**
 * Values shared across layers: wire enumerations, sentinels and event names.
 *
 * Anything the API contract names literally lives here so there is exactly one
 * place to change it, and so a value like the CASH sentinel is never spelled
 * two different ways in two different repositories.
 */

/** Account roles, TRD section 7.5. First matching rule wins when assigning. */
export const ACCOUNT_ROLES = ['source', 'mule', 'cash-out', 'relay', 'coordinator', 'member'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Narrows a stored string to a known role, falling back to 'member'. */
export const toAccountRole = (value: string | null | undefined): AccountRole =>
  ACCOUNT_ROLES.includes(value as AccountRole) ? (value as AccountRole) : 'member';

/** Shared identifier kinds, TRD section 6. */
export const IDENTIFIER_TYPES = ['device', 'phone', 'ip'] as const;
export type IdentifierTypeValue = (typeof IDENTIFIER_TYPES)[number];

/** Payment channels, TRD section 6. */
export const CHANNELS = ['UPI', 'IMPS', 'NEFT', 'ATM'] as const;

/**
 * The account id a cash-out is paid to.
 *
 * It is a sentinel, not a document in accounts. That is only workable because
 * MongoDB has no foreign keys, so a transaction can name a counterparty that has
 * no account of its own. In a relational schema this would need either a fake
 * account row that then showed up in account listings, or a nullable column and
 * a special case in every query.
 */
export const CASH_ACCOUNT_ID = 'CASH';

/** Same idea for the external inflow the generator credits. */
export const SALARY_ACCOUNT_ID = 'SALARY';

export const SYSTEM_ACCOUNT_IDS: readonly string[] = [CASH_ACCOUNT_ID, SALARY_ACCOUNT_ID];

/** Socket event names, from the socket table in TRD section 8. */
export const REPLAY_EVENTS = {
  TXN: 'txn',
  ALERT: 'alert',
  CLOCK: 'replay:clock',
  START: 'replay:start',
  STOP: 'replay:stop',
  END: 'replay:end',
  STATE: 'replay:state',
  ERROR: 'error',
} as const;

export type ReplayEventName = (typeof REPLAY_EVENTS)[keyof typeof REPLAY_EVENTS];

/**
 * Live mode's socket events (docs/STREAMING.md). The generator's data reaches
 * the dashboard as it is made, and the predictor's answers follow it.
 */
export const STREAM_EVENTS = {
  START: 'stream:start',
  STOP: 'stream:stop',
  /** Stop the run if it is going and throw its data away. */
  CLEAR: 'stream:clear',
  STATE: 'stream:state',
  SNAPSHOT: 'stream:snapshot',
  TXNS: 'stream:txns',
  SCORES: 'stream:scores',
  RING: 'stream:ring',
  ALERT: 'stream:alert',
  CLOCK: 'stream:clock',
  END: 'stream:end',
  ERROR: 'stream:error',
} as const;

/** Node and edge discriminators in the ring graph payload. */
export const NODE_TYPES = ['account', 'device', 'phone', 'ip'] as const;
export const EDGE_KINDS = ['txn', 'identity'] as const;

/** A base64 graph PNG larger than this is rejected before it reaches pdfkit. */
export const MAX_GRAPH_PNG_BYTES = 4 * 1024 * 1024;

/** JSON body limit, raised because TRD section 9 sends cy.png() in the body. */
export const JSON_BODY_LIMIT = '6mb';

/**
 * Documents per insertMany command.
 *
 * Batching keeps each command well inside MongoDB's 16MB BSON limit for a
 * six-thousand-document seed, and keeps one validation failure from rejecting a
 * single enormous batch.
 */
export const INSERT_BATCH_SIZE = 1000;
