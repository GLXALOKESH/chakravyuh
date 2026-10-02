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
  IsArray,
  IsIn,
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
