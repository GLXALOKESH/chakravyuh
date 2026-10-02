/** The single metrics document (TRD section 6, "metrics (single document)"). */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import { asArray } from '../utilities/serialize.util.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { Metrics, MetricRow } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

export const KEY = 'main';

export const DEFAULT_NOTE = 'Synthetic data, rings planted by the team';

export const get = async (): Promise<Metrics> => {
  const row = await prisma().metric.findUnique({ where: { key: KEY } });
  return {
    rows: asArray<MetricRow>(row?.rows, []),
    note: row?.note ?? DEFAULT_NOTE,
  };
};

export const set = async (value: { rows: MetricRow[]; note?: string | null }, tx?: Writer): Promise<void> => {
  await writer(tx).metric.upsert({
    where: { key: KEY },
    create: {
      key: KEY,
      rows: (value.rows ?? []) as Prisma.InputJsonValue,
      note: value.note ?? DEFAULT_NOTE,
    },
    update: {
      rows: (value.rows ?? []) as Prisma.InputJsonValue,
      note: value.note ?? DEFAULT_NOTE,
    },
  });
};
