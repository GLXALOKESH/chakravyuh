/**
 * Request DTOs.
 *
 * Every request that takes user input is transformed into one of these with
 * class-transformer and checked with class-validator before a controller sees
 * it, so a controller never parses a query string and a bad request is rejected
 * for the same reason every time.
 *
 * The classes are the single description of what each endpoint accepts; there is
 * no second copy of "k must be 0 to 10" in a controller.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** A path parameter that names a ring, account or alert. */
export class ResourceIdDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'id may only contain letters, numbers, hyphen and underscore' })
  id!: string;
}

/** GET /rings/:id/taint?txn=&as_of= */
export class TaintQueryDto {
  /** Defaults to the ring's first victim transaction. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  txn?: string;

  /** Passed through to Python, which decides the cut-off. */
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'as_of must be an ISO 8601 timestamp' })
  as_of?: string;
}

/** GET /transactions?page=&limit= */
export class TransactionPageQueryDto {
  /** 1-based. Out-of-range values clamp to the last page rather than 404ing. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a positive integer' })
  @Min(1, { message: 'page must be a positive integer' })
  page?: number;

  /**
   * Capped at 500. The pipeline writes several thousand rows and the dashboard
   * renders a slice, so an unbounded limit is a way to ask the server to
   * serialise the entire ledger into one response.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer between 1 and 500' })
  @Min(1, { message: 'limit must be an integer between 1 and 500' })
  @Max(500, { message: 'limit must be an integer between 1 and 500' })
  limit?: number;
}

/** POST /rings/:id/freeze */
export class FreezeBodyDto {
  /** How many accounts to recommend freezing. TRD section 8 default is 3. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'k must be an integer between 0 and 10' })
  @Min(0)
  @Max(10)
  k?: number;

  /**
   * Accounts the investigator has already ruled out. TRD section 7.7: an
   * excluded account must never come back in the recommendation.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  exclude?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  txn?: string;

  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'as_of must be an ISO 8601 timestamp' })
  as_of?: string;
}

/** POST /rings/:id/evidence */
export class EvidenceBodyDto {
  /**
   * Base64 PNG captured by the browser with cy.png(). Only the browser knows the
   * current Cytoscape.js layout, so the graph cannot be redrawn server-side.
   */
  @IsOptional()
  @IsString()
  @MaxLength(6 * 1024 * 1024, { message: 'graph_png is too large' })
  graph_png?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  txn?: string;

  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'as_of must be an ISO 8601 timestamp' })
  as_of?: string;
}

/** POST /replay/start */
export class ReplayStartBodyDto {
  /**
   * Replay seconds per real second. 60 compresses a 7 day dataset into about 10
   * minutes; 3600 replays it quickly. Must be positive or the clock never
   * advances.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'speed must be a positive integer' })
  @Min(1)
  speed?: number;
}

/** POST /stream/start: a new live run (docs/STREAMING.md). */
export class StreamStartBodyDto {
  /** Leave out for a fresh random run; give one to repeat a run exactly. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'seed must be a non-negative integer' })
  @Min(0)
  @Max(4_294_967_295)
  seed?: number;

  /** Simulated seconds per real second. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'rate must be an integer between 1 and 3600' })
  @Min(1)
  @Max(3600)
  rate?: number;

  /** No generator is started; events arrive on POST /stream/ingest. */
  @IsOptional()
  @IsBoolean()
  external?: boolean;
}

/**
 * POST /stream/ingest: generator lines from a generator the server did not
 * start. Each line is checked field by field as it is taken in, so the DTO
 * only bounds the batch.
 */
export class StreamIngestBodyDto {
  @IsArray()
  @ArrayMaxSize(20_000)
  @IsObject({ each: true })
  events!: Record<string, unknown>[];
}

/** POST /pipeline/run, the manual pipeline trigger. */
export class PipelineRunBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsIn(['demo', 'train', 'holdout', 'full'], { message: 'profile must be demo, train, holdout or full' })
  profile?: string;
}

/** Converts "a,b,c" and repeated query params into a clean list. */
export const csvToArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(','));
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

/** Strips whitespace so " 3 " is accepted as 3 rather than failing obscurely. */
export const trimString = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export const optionalTrimmedString = Transform(trimString);
