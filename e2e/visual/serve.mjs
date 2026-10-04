import { build, preview } from '../../web/node_modules/vite/dist/node/index.js';
import config from './vite.config.mjs';

// Deliberately no Compose, database, existing-stack detection, or API proxy.
await build(config);
await preview(config);
