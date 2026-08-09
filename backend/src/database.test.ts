import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

function createLegacyDatabase(): { db: Database; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "notedb-migration-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "notes.db");
  const db = new Database(path);
  db.run(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serial TEXT NOT NULL,
        currency TEXT NOT NULL,
        denomination INTEGER NOT NULL,
        created TEXT NOT NULL,
        UNIQUE(serial, currency)
      )
    `);
  return { db, path };
}

describe("notes database schema", () => {
  it("creates the current schema for a new database", () => {
    const directory = mkdtempSync(join(tmpdir(), "notedb-schema-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(join(directory, "notes.db"));

    expect(
      db.query<{ user_version: number }, []>("PRAGMA user_version").get(),
    ).toEqual({ user_version: 1 });
    db.query(
      "INSERT INTO notes (serial, currency, denomination, created) VALUES (?, ?, ?, ?)",
    ).run("A23456789A", "USD", 1, new Date().toISOString());
    expect(() =>
      db
        .query(
          "INSERT INTO notes (serial, currency, denomination, created) VALUES (?, ?, ?, ?)",
        )
        .run("A23456789A", "USD", 2, new Date().toISOString()),
    ).not.toThrow();

    db.close();
  });

  it("migrates legacy data and normalises its fields", () => {
    const { db: legacyDb, path } = createLegacyDatabase();
    legacyDb
      .query(
        "INSERT INTO notes (serial, currency, denomination, created) VALUES (?, ?, ?, ?)",
      )
      .run("pa8124161759", "eur", 10, "2026-08-02T12:00:00.000Z");
    legacyDb.close();

    const db = openDatabase(path);

    expect(
      db
        .query("SELECT serial, currency, denomination, created FROM notes")
        .all(),
    ).toEqual([
      {
        serial: "PA8124161759",
        currency: "EUR",
        denomination: 10,
        created: "2026-08-02T12:00:00.000Z",
      },
    ]);
    expect(
      db.query<{ user_version: number }, []>("PRAGMA user_version").get(),
    ).toEqual({ user_version: 1 });
    db.close();
  });

  it("refuses to merge legacy records that collide after normalisation", () => {
    const { db: legacyDb, path } = createLegacyDatabase();
    const insert = legacyDb.query(
      "INSERT INTO notes (serial, currency, denomination, created) VALUES (?, ?, ?, ?)",
    );
    insert.run("PA8124161759", "EUR", 10, "2026-08-02T12:00:00.000Z");
    insert.run("pa8124161759", "EUR", 10, "2026-08-03T12:00:00.000Z");
    legacyDb.close();

    expect(() => openDatabase(path)).toThrow(
      "cannot migrate notes database because serial normalisation would merge records: PA8124161759 (EUR 10, 2 records)",
    );

    const unchangedDb = new Database(path);
    expect(
      unchangedDb.query("SELECT serial FROM notes ORDER BY id").all(),
    ).toEqual([{ serial: "PA8124161759" }, { serial: "pa8124161759" }]);
    unchangedDb.close();
  });
});
