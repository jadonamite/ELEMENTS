import { readChainConfig } from './config.js';
import { nearClient, Settler } from './settler.js';

export { genesisArgs, playerImplicitAccount, worldAccount } from './accounts.js';
export { readChainConfig } from './config.js';
export { Settler } from './settler.js';

let active: Settler | null = null;

export function startChainSettlement(): Settler | null {
  const config = readChainConfig();
  if (!config) {
    console.log('[chain] NEAR settings missing; CHROMA stays on the server ledger only.');
    return null;
  }
  active = new Settler(config, nearClient(config));
  active.start();
  console.log(`[chain] settling CHROMA to ${config.contractId} on ${config.network} every ${config.settleEveryMs / 1000} s`);
  return active;
}

export function chainSettler(): Settler | null {
  return active;
}
