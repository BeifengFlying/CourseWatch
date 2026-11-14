import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  db: Database.Database;
  private statements = new Map<string, Database.Statement>();
  private prepare(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (this.statements.size >= 64)
        this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
 INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS platforms(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,source_key TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(platform,account_id,source_key));
 CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,task_id TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY,platform TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,dedupe TEXT UNIQUE NOT NULL,at INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,task_id TEXT,kind TEXT NOT NULL,read_at INTEGER,delivered_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT);
 CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,due_at INTEGER NOT NULL,deadline_version INTEGER NOT NULL,rule_hours REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS clients(hash TEXT PRIMARY KEY,origin TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS tasks_account ON tasks(platform,account_id);
 CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due_at);
 CREATE INDEX IF NOT EXISTS history_at ON history(at DESC);
 CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(delivered_at,next_attempt);
 CREATE TABLE IF NOT EXISTS notification_deliveries(outbox_id INTEGER NOT NULL,channel TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,accepted_at INTEGER,error TEXT,PRIMARY KEY(outbox_id,channel,target));
 CREATE INDEX IF NOT EXISTS notification_deliveries_pending ON notification_deliveries(status,next_attempt);
 CREATE TRIGGER IF NOT EXISTS notification_deliveries_delete AFTER DELETE ON outbox BEGIN DELETE FROM notification_deliveries WHERE outbox_id=OLD.id; END;
 `);
  }
  get<T>(key: string, fallback: T): T {
    const row = this
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key: string, value: unknown) {
    this
      .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
      .run(key, JSON.stringify(value));
  }
  all<T>(sql: string, ...args: any[]): T[] {
    return this.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: any[]) {
    return this.prepare(sql).run(...args);
  }
  close() {
    this.statements.clear();
    this.db.close();
  }
  backup(path: string) {
    return this.db.backup(path);
  }
}
