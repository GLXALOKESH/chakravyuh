/** The single metrics document (TRD section 6, "metrics (single document)"). */
import { Metric, METRICS_ID } from '../models/metric.model.js';
import { logQuery } from '../utilities/db-log.util.js';
import { asArray } from '../utilities/serialize.util.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { MetricRow, Metrics } from '../interfaces/domain.interface.js';

/**
 * The _id of the one metrics document, kept re-exported because the seeder and
 * the tests both refer to it and it is meaningless outside the model layer.
 */
export { METRICS_ID };

export const DEFAULT_NOTE = 'Synthetic data, rings planted by the team';

export const get = async (): Promise<Metrics> => {
  const row = await logQuery(Metric.findById(METRICS_ID).lean());
  return {
    rows: asArray<MetricRow>(row?.rows, []),
    note: row?.note ?? DEFAULT_NOTE,
  };
};

/**
 * Replaces the metrics document, creating it if absent.
 *
 * A single upsert keyed on the _id, which is the whole point of storing one
 * document per the contract rather than a row per model: there is no delete and
 * no second query, just the one write.
 */
export const set = async (value: { rows: MetricRow[]; note?: string | null }, tx?: Writer): Promise<void> => {
  await logQuery(Metric.findOneAndUpdate(
    { _id: METRICS_ID },
    { $set: { rows: value.rows ?? [], note: value.note ?? DEFAULT_NOTE } },
    { upsert: true, returnDocument: 'after', session: tx },
  ));
};
