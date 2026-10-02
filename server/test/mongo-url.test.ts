/**
 * Connection string handling.
 *
 * The case that matters is the one that fails quietly: a MongoDB URL with no
 * database name does not error, it connects to a database called `test`. Every
 * query then succeeds while the data goes somewhere nobody is looking, so this
 * is the sort of bug that survives a manual smoke test and only shows up as a
 * mysteriously empty dashboard.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../src/configs/env.js';
import { databaseNameOf, withDatabaseName, withDefaultDatabaseName } from '../src/utilities/mongo-url.util.js';

const ATLAS = 'mongodb+srv://user:pass@cluster0.abcde.mongodb.net';
const ATLAS_WITH_OPTIONS =
  'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority';
const LOCAL = 'mongodb://127.0.0.1:27017/chakravyuh';

describe('reading the database name out of a connection string', () => {
  it('finds the name when there is one', () => {
    expect(databaseNameOf(LOCAL)).toBe('chakravyuh');
    expect(databaseNameOf('mongodb://127.0.0.1:27017/chakravyuh?replicaSet=rs0')).toBe('chakravyuh');
  });

  it('reports no name for the three ways one can be missing', () => {
    // Atlas hands these out, and they are all the same string after parsing.
    expect(databaseNameOf(ATLAS)).toBeNull();
    expect(databaseNameOf(`${ATLAS}/`)).toBeNull();
    expect(databaseNameOf(ATLAS_WITH_OPTIONS)).toBeNull();
  });
});

describe('filling in a missing database name', () => {
  it('adds one without disturbing the rest', () => {
    // Credentials and query options have to survive: dropping retryWrites turns
    // a working Atlas string into one that errors on every write.
    expect(withDefaultDatabaseName(ATLAS_WITH_OPTIONS, 'chakravyuh')).toBe(
      'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/chakravyuh?retryWrites=true&w=majority',
    );
    expect(withDefaultDatabaseName(ATLAS, 'chakravyuh')).toBe(
      'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/chakravyuh',
    );
  });

  it('leaves a URL that already names a database alone', () => {
    // Re-pointing a working URL at the default would be the actual bug here.
    expect(withDefaultDatabaseName(LOCAL, 'chakravyuh')).toBe(LOCAL);
    expect(withDatabaseName(LOCAL, 'chakravyuh_test')).toBe('mongodb://127.0.0.1:27017/chakravyuh_test');
  });
});

describe('the url this process actually resolved', () => {
  it('always carries a database name, whatever MONGO_URL looked like', () => {
    // Guards the real configuration: env.ts runs this over MONGO_URL at import.
    expect(databaseNameOf(config.mongoUrl)).not.toBeNull();
  });
});
