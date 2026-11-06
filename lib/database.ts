import 'server-only';
import { neon } from '@neondatabase/serverless';
import { GameError } from './game-engine';
import { RoomStore } from './room-store';

let ready: Promise<RoomStore> | undefined;

export async function database(): Promise<RoomStore> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new GameError('The party service is not configured yet. Please check the deployment.', 503);
  if (!ready) {
    ready = (async () => {
      const sql = neon(connectionString);
      const store = new RoomStore(async (text, values = []) => {
        const rows = await sql.query(text, values);
        return rows as Record<string, unknown>[];
      });
      // Idempotent setup. No separate SQL or migration command is needed to start.
      await store.initialize();
      return store;
    })();
  }
  try { return await ready; }
  catch (error) { ready = undefined; throw error; }
}
