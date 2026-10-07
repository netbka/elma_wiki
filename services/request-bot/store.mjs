import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Single-host durable coordinator. Workers access it through HTTP, never the file. */
export class Store {
  constructor(filename) {
    if (filename !== ':memory:') {
      filename = resolve(filename);
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      try { closeSync(openSync(filename, 'wx', 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) throw Error('Unsafe database path');
      chmodSync(filename, 0o600);
    }
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 2) throw Error('Database schema is newer than this service');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY, project TEXT NOT NULL, owner TEXT NOT NULL, chat TEXT NOT NULL,
          record TEXT NOT NULL CHECK(json_valid(record))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS inbox (
          event_key TEXT PRIMARY KEY, outcome TEXT NOT NULL, created INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS cursors (stream TEXT PRIMARY KEY, position INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), revision INTEGER NOT NULL,
          kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
          worker TEXT, token TEXT, expires INTEGER, deadline INTEGER, result_hash TEXT,
          UNIQUE(request_id,revision,kind)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,kind,id);
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY, request_id TEXT REFERENCES requests(id), kind TEXT NOT NULL,
          revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
          status TEXT NOT NULL DEFAULT 'queued', token TEXT, expires INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0, provider_id TEXT, error_code TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS outbox_queue ON outbox(status,id);
        CREATE TABLE IF NOT EXISTS actions (
          digest TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), revision INTEGER NOT NULL,
          actor TEXT NOT NULL, action TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY, request_id TEXT REFERENCES requests(id), actor TEXT NOT NULL,
          event TEXT NOT NULL, revision INTEGER, created INTEGER NOT NULL
        ) STRICT;
      `);
      if (version < 2) this.db.exec(`
        DROP INDEX jobs_queue;
        ALTER TABLE jobs RENAME TO jobs_v1;
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), revision INTEGER NOT NULL,
          kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
          worker TEXT, token TEXT, expires INTEGER, deadline INTEGER, result_hash TEXT,
          iteration INTEGER NOT NULL DEFAULT 0 CHECK(iteration BETWEEN 0 AND 2),
          UNIQUE(request_id,revision,kind,iteration)
        ) STRICT;
        INSERT INTO jobs(id,request_id,revision,kind,status,attempts,worker,token,expires,deadline,result_hash)
          SELECT id,request_id,revision,kind,status,attempts,worker,token,expires,deadline,result_hash FROM jobs_v1;
        DROP TABLE jobs_v1;
        CREATE INDEX jobs_queue ON jobs(status,kind,id);
        PRAGMA user_version=2;
      `);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      if (value?.then) throw Error('Transactions must not contain asynchronous work');
      this.db.exec('COMMIT');
      return value;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  request(id) {
    const row = this.get('SELECT record FROM requests WHERE id=?', id);
    return row ? JSON.parse(row.record) : undefined;
  }
  save(r) {
    this.run(`INSERT INTO requests(id,project,owner,chat,record) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record=excluded.record`, r.id, r.project, r.owner, r.chat, JSON.stringify(r));
  }
  close() { this.db.close(); }
}
