/**
 * Shared schema pieces and the model factory.
 *
 * Field names are the snake_case of TRD section 6 verbatim, because section 6
 * says "field names below are the contract between all three services". There is
 * no column mapping layer to get wrong: what the Python pipeline writes into
 * data/<profile>/*.json is what lands in the document, and what the dashboard
 * reads is what the API returns.
 *
 * Two consequences of the document model worth knowing:
 *
 *   - `from` and `to` are legal field names. They are SQL keywords, not
 *     MongoDB ones, so transactions store exactly the keys TRD section 6 shows.
 *
 *   - There are no foreign keys. A cash-out is a transaction paid to the CASH
 *     sentinel, which is deliberately not a row in accounts, and that is a
 *     legal document rather than a referential-integrity problem to work
 *     around. See CASH_ACCOUNT_ID in src/constants.
 *
 * `_id` is a string on every model, because TRD section 6 says "IDs are
 * strings". No ObjectId is generated anywhere in the project.
 */
import { Schema } from 'mongoose';

/** Shared by accounts.home and transactions.location. TRD section 6. */
export const geoPointSchema = new Schema(
  {
    city: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false },
);

/** One "why flagged" line in the entity panel. TRD section 6, accounts.signals. */
export const signalSchema = new Schema(
  {
    feature: { type: String, required: true },
    label: { type: String, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * Registers a model, replacing any model already registered under the name.
 *
 * Mongoose keeps a process-global registry and throws OverwriteModelError on a
 * duplicate name, so the second compile of a schema is a startup crash with a
 * confusing message. Dropping the stale entry first makes a schema edit take
 * effect on reload instead, which is what tsx watch and vitest both need.
 */
/**
 * Models are registered by calling mongoose.model(name, schema) directly in each
 * model's own file, not through a wrapper here.
 *
 * Mongoose infers a model's document type from its schema argument, so a
 * wrapper with its own type parameter discards that inference and every model
 * comes out typed as a bare Document. Calling through directly keeps the schema
 * and the queries in agreement, which is the whole reason for using an ORM with
 * a type system.
 */

/**
 * Index options shared by every collection.
 *
 * versionKey is off because the TRD contract documents have no __v, and
 * MongoDB cannot enforce a schema, so a stray bookkeeping field is one more
 * thing that can drift from section 6. timestamps are off for the same reason:
 * opened_at, fired_at and ts are part of the contract and come from the
 * generator, not from when the seeder happened to run.
 */
/**
 * Schema options every collection shares.
 *
 * strictQuery 'throw' is the important one: a query naming a field the schema
 * does not have throws instead of silently matching nothing. That matters most
 * while this project is new to MongoDB, where the natural mistake is to query
 * the camelCase name a relational ORM would have used - `{ ringId: 'RING01' }`
 * returns zero rows rather than failing, and a ring with no members looks like
 * a data problem rather than a typo.
 *
 * Mongoose 9 takes this per schema, not as a connection option.
 */
export const collection = (name: string) => ({
  collection: name,
  versionKey: false as const,
  timestamps: false as const,
  strictQuery: 'throw' as const,
});