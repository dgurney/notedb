import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 1;
const CREATE_NOTES_TABLE = `
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    currency TEXT NOT NULL,
    denomination INTEGER NOT NULL,
    created TEXT NOT NULL,
    UNIQUE(serial, currency, denomination)
  )
`;

type NormalisationCollision = {
  serial: string;
  currency: string;
  denomination: number;
  count: number;
};

function notesTableExists(db: Database): boolean {
  return (
    db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
      )
      .get() !== null
  );
}

function createSchema(db: Database): void {
  db.transaction(() => {
    db.run(CREATE_NOTES_TABLE);
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

function migrateLegacySchema(db: Database): void {
  const collisions = db
    .query<NormalisationCollision, []>(`
      SELECT
        UPPER(serial) AS serial,
        UPPER(currency) AS currency,
        denomination,
        COUNT(*) AS count
      FROM notes
      GROUP BY UPPER(serial), UPPER(currency), denomination
      HAVING COUNT(*) > 1
    `)
    .all();

  if (collisions.length > 0) {
    const collidingNotes = collisions
      .map(
        ({ serial, currency, denomination, count }) =>
          `${serial} (${currency} ${denomination}, ${count} records)`,
      )
      .join(", ");
    throw new Error(
      `cannot migrate notes database because serial normalisation would merge records: ${collidingNotes}`,
    );
  }

  db.transaction(() => {
    db.run("ALTER TABLE notes RENAME TO notes_legacy");
    db.run(CREATE_NOTES_TABLE);
    db.run(`
          INSERT INTO notes (id, serial, currency, denomination, created)
          SELECT id, UPPER(serial), UPPER(currency), denomination, created
          FROM notes_legacy
        `);
    db.run("DROP TABLE notes_legacy");
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

function initialiseDatabase(db: Database): void {
  // PRAGMA user_version is documented to always return exactly one row
  const schemaVersion = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get()!.user_version;
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `notes database schema version ${schemaVersion} is newer than supported version ${SCHEMA_VERSION}`,
    );
  }

  const hasNotesTable = notesTableExists(db);
  if (!hasNotesTable) {
    if (schemaVersion !== 0) {
      throw new Error(
        `notes database schema version is ${schemaVersion}, but the notes table is missing`,
      );
    }
    createSchema(db);
    return;
  }

  if (schemaVersion === 0) {
    migrateLegacySchema(db);
  }
}

export function openDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  try {
    initialiseDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
