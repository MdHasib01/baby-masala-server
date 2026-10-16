import { readFileSync } from 'node:fs';
import { canonDeep } from '../utils/bnText.js';

/** The frontend's original mock data, exported to JSON (see backend/README.md). */
export const seedData = canonDeep(JSON.parse(readFileSync(new URL('./seedData.json', import.meta.url), 'utf8')));
