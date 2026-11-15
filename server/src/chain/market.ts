import { getDatabase } from '../db.js';
import { MarketService } from '../economy/marketService.js';
import { NearMarketChain } from './marketClient.js';
import { readMarketConfig } from './marketConfig.js';
let active: MarketService | null = null;
export function marketBoard(): MarketService | null { return active; }
export function startMarketBoard() {
  const config = readMarketConfig();
  if (!config) return;
  active = new MarketService(getDatabase(),config,new NearMarketChain(config));
  const run = () => { void active?.tick().catch(error => console.error('[market]',String(error))); };
  run(); setInterval(run,5_000).unref();
}
