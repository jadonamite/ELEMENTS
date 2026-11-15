// Prints the CHROMA contract's `new` arguments for a game account: the server's genesis split.
// Usage: npx tsx scripts/chain-genesis.ts <game-account>
import { genesisArgs } from '../src/chain/accounts.js';

const account = process.argv[2];
if (!account) {
  console.error('Usage: npx tsx scripts/chain-genesis.ts <game-account>');
  process.exit(1);
}
console.log(JSON.stringify(genesisArgs(account)));
