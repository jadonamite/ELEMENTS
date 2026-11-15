import { readChainConfig } from './config.js';
import { worldAccount } from './accounts.js';
export function readMarketConfig(env: NodeJS.ProcessEnv = process.env) {
  const chain = readChainConfig(env);
  if (!chain || !env.INTENTS_CONTRACT_ID || !env.ITEMS_CONTRACT_ID) return null;
  return { ...chain, verifier: env.INTENTS_CONTRACT_ID, items: env.ITEMS_CONTRACT_ID,
    broker: worldAccount('market-broker', chain.gameAccount), treasury: worldAccount('treasury', chain.gameAccount) };
}
export type MarketConfig = NonNullable<ReturnType<typeof readMarketConfig>>;
