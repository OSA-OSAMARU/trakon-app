import { handle } from 'hono/vercel';

import { app } from './app.js';

export const config = {
  runtime: 'nodejs',
  regions: ['hnd1'],
};

export default handle(app);
