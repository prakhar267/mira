export interface SqlStorage {
  exec(query: string, ...values: (string | number | null)[]): { toArray(): Record<string, unknown>[]; rowsWritten?: number };
}

/** One SQLite coordinator for this beta. SQL calls are synchronous and each
 * action runs inside a Durable Object transaction. No raw content is logged. */
export class StoreEngine {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT, expires INTEGER, deleted INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE INDEX IF NOT EXISTS record_expiry ON records(expires)");
    sql.exec("CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS metrics (day TEXT, name TEXT, total INTEGER NOT NULL, failures INTEGER NOT NULL, duration INTEGER NOT NULL, PRIMARY KEY(day,name))");
    sql.exec("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, received INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS metric_windows (minute INTEGER, name TEXT, total INTEGER, failures INTEGER, duration INTEGER, max_duration INTEGER, le1000 INTEGER, le2500 INTEGER, le5000 INTEGER, le8000 INTEGER, le15000 INTEGER, PRIMARY KEY(minute,name))");
  }
  row(key: string) { return this.sql.exec("SELECT * FROM records WHERE key = ?", key).toArray()[0]; }
  get(key: string) {
    const row = this.row(key);
    return row && !row.deleted && (!row.expires || Number(row.expires) > Date.now()) ? row.value as string : null;
  }
  put(key: string, value: string, ttl?: number) {
    const owner = /^(?:state|backup|account):([^:]+)/.exec(key)?.[1];
    if (owner && this.row(`account:${owner}`)?.deleted) throw new Error("Account was deleted");
    this.sql.exec("INSERT INTO records(key,value,expires,deleted) VALUES(?,?,?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires, deleted=0", key, value, ttl ? Date.now() + ttl * 1000 : null);
  }
  remove(key: string) {
    // Keep a content-free tombstone: old KV data must never be imported again.
    this.sql.exec("INSERT INTO records(key,value,deleted) VALUES(?,NULL,1) ON CONFLICT(key) DO UPDATE SET value=NULL,expires=NULL,deleted=1", key);
  }
  eraseAccount(userId:string, emailKey:string, legacyKeys:string[]) {
    const keys=new Set([`account:${userId}`,`state:${userId}`,`email:${emailKey}`,`billing:${userId}`,...legacyKeys]);
    for(const row of this.sql.exec("SELECT key FROM records WHERE key >= ? AND key < ?",`backup:${userId}:`,`backup:${userId}:\uffff`).toArray())keys.add(String(row.key));
    for(const row of this.sql.exec("SELECT key FROM records WHERE (key LIKE 'session:%' OR key LIKE 'recovery:%') AND deleted=0 AND json_valid(value) AND json_extract(value,'$.userId')=?",userId).toArray())keys.add(String(row.key));
    this.remove(`account:${userId}`); // Fence concurrent autosaves first, in this transaction.
    for(const key of keys){this.remove(key);this.put(`purge:${key}`,JSON.stringify({key}));}
    return [...keys];
  }
  list(prefix: string, cursor = "", limit = 200) {
    return this.sql.exec("SELECT key FROM records WHERE key >= ? AND key < ? AND key > ? AND deleted=0 AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?", prefix, `${prefix}\uffff`, cursor, Date.now(), limit + 1).toArray().map((r) => String(r.key));
  }
  rate(key: string, max: number, seconds: number) {
    const bucket = `${key}:${Math.floor(Date.now() / (seconds * 1000))}`;
    const row = this.sql.exec("INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count", bucket, Date.now() + seconds * 2000).toArray()[0];
    return Number(row?.count) > max;
  }
  metric(name: string, failed: boolean, duration: number) {
    const ms = Math.max(0, Math.min(120000, Math.round(duration)));
    this.sql.exec("INSERT INTO metric_windows VALUES(?,?,1,?,?,?,?,?,?,?,?) ON CONFLICT(minute,name) DO UPDATE SET total=total+1,failures=failures+excluded.failures,duration=duration+excluded.duration,max_duration=max(max_duration,excluded.max_duration),le1000=le1000+excluded.le1000,le2500=le2500+excluded.le2500,le5000=le5000+excluded.le5000,le8000=le8000+excluded.le8000,le15000=le15000+excluded.le15000",Math.floor(Date.now()/60000),name,failed?1:0,ms,ms,...[1000,2500,5000,8000,15000].map(bound=>ms<=bound?1:0));
    this.sql.exec("INSERT INTO metrics(day,name,total,failures,duration) VALUES(?,?,1,?,?) ON CONFLICT(day,name) DO UPDATE SET total=total+1, failures=failures+excluded.failures, duration=duration+excluded.duration", new Date().toISOString().slice(0,10), name, failed ? 1 : 0, Math.max(0, Math.min(120000, Math.round(duration))));
  }
  metrics() { return this.sql.exec("SELECT day,name,total,failures,round(duration * 1.0 / total) AS averageLatencyMs FROM metrics WHERE day >= ? ORDER BY day DESC,name", new Date(Date.now()-7*86400000).toISOString().slice(0,10)).toArray(); }
  recentMetrics() {
    return this.sql.exec("SELECT name,sum(total) AS total,sum(failures) AS failures,round(sum(duration)*1.0/sum(total)) AS averageLatencyMs,max(max_duration) AS maxLatencyMs,sum(le1000) AS le1000,sum(le2500) AS le2500,sum(le5000) AS le5000,sum(le8000) AS le8000,sum(le15000) AS le15000 FROM metric_windows WHERE minute>=? GROUP BY name",Math.floor(Date.now()/60000)-14).toArray().map(row=>({...row,p95UpperBoundMs:[1000,2500,5000,8000,15000].find(bound=>Number(row[`le${bound}`])>=Number(row.total)*.95)??120000,windowMinutes:15}));
  }
  capacity() { return this.sql.exec("SELECT key,count FROM limits WHERE key LIKE 'capacity:%' AND key LIKE ?",`%:${Math.floor(Date.now()/86400000)}`).toArray(); }
  cleanup() {
    // Tombstone expired records so stale KV values cannot return after cleanup.
    this.sql.exec("UPDATE records SET value=NULL,deleted=1,expires=NULL WHERE expires <= ? AND deleted=0", Date.now());
    this.sql.exec("DELETE FROM limits WHERE expires <= ?", Date.now());
    this.sql.exec("DELETE FROM metrics WHERE day < ?", new Date(Date.now()-30*86400000).toISOString().slice(0,10));
    this.sql.exec("DELETE FROM receipts WHERE received < ?", Date.now()-90*86400000);
    this.sql.exec("DELETE FROM metric_windows WHERE minute < ?", Math.floor(Date.now()/60000)-1440);
  }
  resetPassword(tokenKey: string, hash: string, salt: string) {
    const token = this.get(tokenKey);
    if (!token) return false;
    const userId = JSON.parse(token).userId as string;
    const raw = this.get(`account:${userId}`);
    if (!raw) return false;
    const account = JSON.parse(raw);
    account.passwordHash = hash; account.passwordSalt = salt;
    account.passwordChangedAt = new Date().toISOString();
    this.put(`account:${userId}`, JSON.stringify(account));
    this.remove(tokenKey);
    return true;
  }
  claimEmail(emailKey: string, account: { id: string }) {
    if (this.get(emailKey)) return false;
    this.put(`account:${account.id}`, JSON.stringify(account));
    this.put(emailKey, account.id);
    return true;
  }
  billing(id: string, userId: string, timestamp: string, subscription: Record<string, unknown>) {
    if (this.sql.exec("SELECT id FROM receipts WHERE id=?", id).toArray().length) return;
    const key = `billing:${userId}`;
    const current = JSON.parse(this.get(key) ?? "null");
    if (this.get(`account:${userId}`) && (!current || timestamp >= current.timestamp)) this.put(key, JSON.stringify({ ...subscription, timestamp }));
    this.sql.exec("INSERT INTO receipts(id,received) VALUES(?,?)", id, Date.now());
  }
}
