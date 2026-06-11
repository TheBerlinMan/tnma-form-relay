// Node runtime (default for /api functions). Do NOT switch this to the Edge
// runtime: the Phase 2 database layer and any TCP-based drivers require Node.
// `hono/vercel` is the EDGE adapter — on Node it hangs ("default export
// returned a Response"). Node needs a (req, res) listener, plus the
// NODEJS_HELPERS=0 env var so Vercel's helpers don't consume the body stream.
// (@hono/node-server v2 removed its /vercel subpath; getRequestListener is
// what that adapter wrapped.)
import { getRequestListener } from '@hono/node-server';
import app from '../src/app.js';

export default getRequestListener(app.fetch);
