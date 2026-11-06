import { database } from '../../../lib/database';
import { createGameHandler } from '../../../lib/game-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = createGameHandler(database);
export const GET = handle;
export const POST = handle;
