import { readChainConfig, readItemsChainConfig } from './config.js';
import { nearClient, Settler } from './settler.js';

export { genesisArgs, playerImplicitAccount, worldAccount, worldHolders, worldKeyPair } from './accounts.js';
export { readChainConfig, readItemsChainConfig } from './config.js';
export { Settler } from './settler.js';

let active: Settler | null = null;
let itemsActive: Settler | null = null;

export function startChainSettlement(): Settler | null {
  const config = readChainConfig();
  if (config) {
    active = new Settler(config, nearClient(config));
    active.start();
    console.log(`[chain] settling CHROMA to ${config.contractId} on ${config.network} every ${config.settleEveryMs / 1000} s`);
  } else {
    console.log('[chain] NEAR settings missing; CHROMA stays on the server ledger only.');
  }
  const items = readItemsChainConfig();
  if (items) {
    itemsActive = new Settler(items, nearClient(items, 'items'), undefined, 'items');
    itemsActive.start();
    console.log(`[chain] settling items to ${items.contractId} on ${items.network} every ${items.settleEveryMs / 1000} s`);
  } else {
    console.log('[chain] item contract settings missing; items stay on the server ledger only.');
  }
  return active;
}

export function chainSettler(): Settler | null {
  return active;
}

export function itemsChainSettler(): Settler | null { return itemsActive; }
