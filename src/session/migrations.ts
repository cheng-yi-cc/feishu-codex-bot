import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openSessionDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(loadSessionSchemaSql());

  return db;
}

function loadSessionSchemaSql(): string {
  const schemaCandidates = [
    new URL("./schema.sql", import.meta.url),
    new URL("../../src/session/schema.sql", import.meta.url),
  ];

  for (const schemaPath of schemaCandidates) {
    try {
      return fs.readFileSync(schemaPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error("Unable to locate session schema SQL.");
}
