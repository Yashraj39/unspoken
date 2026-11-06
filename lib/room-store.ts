// SQL contains room state only. There is no plaintext vote or question-author table.
export type RoomRow = { code: string; revision: number; expires: string | number; lobby: string; game: string };
export type Query = (text: string, parameters?: unknown[]) => Promise<Record<string, unknown>[]>;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rooms (
    code VARCHAR(6) PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
    revision INTEGER NOT NULL DEFAULT 0,
    expires BIGINT NOT NULL,
    lobby TEXT NOT NULL,
    game TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS rooms_expires_idx ON rooms (expires)',
];

export class RoomStore {
  constructor(private readonly query: Query) {}

  async initialize(): Promise<void> {
    for (const statement of SCHEMA) await this.query(statement);
  }

  async deleteExpired(now: number): Promise<void> {
    await this.query('DELETE FROM rooms WHERE expires < $1', [now]);
  }

  async create(code: string, expires: number, lobby: string, game: string): Promise<boolean> {
    const rows = await this.query(
      'INSERT INTO rooms (code, revision, expires, lobby, game) VALUES ($1, 0, $2, $3, $4) ON CONFLICT (code) DO NOTHING RETURNING code',
      [code, expires, lobby, game],
    );
    return rows.length === 1;
  }

  async get(code: string, now: number): Promise<RoomRow | null> {
    const rows = await this.query('SELECT code, revision, expires, lobby, game FROM rooms WHERE code = $1 AND expires > $2', [code, now]);
    return (rows[0] as RoomRow | undefined) ?? null;
  }

  async replace(code: string, revision: number, lobby: string, game: string): Promise<boolean> {
    // Compare-and-swap prevents concurrent players overwriting each other's actions.
    const rows = await this.query(
      'UPDATE rooms SET lobby = $1, game = $2, revision = revision + 1 WHERE code = $3 AND revision = $4 RETURNING revision',
      [lobby, game, code, revision],
    );
    return rows.length === 1;
  }

  async remove(code: string, revision: number): Promise<void> {
    await this.query('DELETE FROM rooms WHERE code = $1 AND revision = $2', [code, revision]);
  }
}
