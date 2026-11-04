import fs from 'node:fs';
import type { RaidsConfig, SocialConfig } from '@elements/shared';

const balance = JSON.parse(fs.readFileSync(new URL('../../../shared/balance.json', import.meta.url), 'utf8')) as { raids: RaidsConfig; social: SocialConfig };

export const RAIDS: RaidsConfig = balance.raids;
export const SOCIAL: SocialConfig = balance.social;
export const HALL_ID = 'hall_sindr';
