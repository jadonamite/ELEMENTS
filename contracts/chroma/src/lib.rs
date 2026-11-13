//! CHROMA, the coin of ELEMENTS, as a NEP-141 token.
//!
//! The whole supply is split at creation exactly as the game server's genesis splits it.
//! After that the game account settles the server's ledger in numbered batches: each batch
//! carries the ledger's moves in order, so chain balances always match the server's books.
//! Every move is logged as a standard NEP-141 transfer event.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Accounts,
    Metadata,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
#[borsh(crate = "near_sdk::borsh")]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Vec<u8>>,
    pub decimals: u8,
}

/// One ledger move. `memo` carries the server's ledger reason and entry id.
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Move {
    pub from: AccountId,
    pub to: AccountId,
    pub amount: U128,
    pub memo: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23b8862b'/%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23f3d27a' stroke-width='2'/%3E%3Cpath d='M16 7l3 9-3 9-3-9z' fill='%23f3d27a'/%3E%3C/svg%3E";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ChromaContract {
    pub owner_id: AccountId,
    pub total_supply: u128,
    pub accounts: LookupMap<AccountId, u128>,
    pub metadata: LazyOption<FungibleTokenMetadata>,
    pub last_batch: u64,
}

fn transfer_event(from: &AccountId, to: &AccountId, amount: u128, memo: &Option<String>) {
    let mut data = json!({
        "old_owner_id": from,
        "new_owner_id": to,
        "amount": amount.to_string(),
    });
    if let Some(m) = memo {
        data["memo"] = json!(m);
    }
    let event = json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", event));
}

#[near]
impl ChromaContract {
    /// `genesis` is the server's opening split; the total supply is its sum.
    #[init]
    pub fn new(owner_id: AccountId, genesis: Vec<(AccountId, U128)>) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");
        require!(!genesis.is_empty(), "Genesis split is empty");

        let mut accounts = LookupMap::new(StorageKey::Accounts);
        let mut total_supply: u128 = 0;
        let mut minted = Vec::new();
        for (account, amount) in genesis {
            require!(amount.0 > 0, "Genesis amounts must be positive");
            require!(accounts.get(&account).is_none(), "Genesis account listed twice");
            accounts.insert(&account, &amount.0);
            total_supply = total_supply.checked_add(amount.0).expect("Supply overflow");
            minted.push(json!({ "owner_id": account, "amount": amount.0.to_string(), "memo": "genesis" }));
        }
        let event = json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": minted });
        env::log_str(&format!("EVENT_JSON:{}", event));

        let metadata = FungibleTokenMetadata {
            spec: "ft-1.0.0".to_string(),
            name: "CHROMA".to_string(),
            symbol: "CHROMA".to_string(),
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 0,
        };

        Self {
            owner_id,
            total_supply,
            accounts,
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            last_batch: 0,
        }
    }

    /// Applies one batch of the server ledger. Batches must arrive in order, so a batch
    /// that was already applied is refused rather than counted twice.
    pub fn settle(&mut self, batch: u64, moves: Vec<Move>) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the game account settles");
        require!(batch == self.last_batch + 1, "Batch out of order");
        for m in moves.iter() {
            self.internal_transfer(&m.from, &m.to, m.amount.0, &m.memo);
        }
        self.last_batch = batch;
    }

    pub fn last_batch(&self) -> u64 {
        self.last_batch
    }

    pub fn owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.accounts.get(&account_id).unwrap_or(0))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender_id = env::predecessor_account_id();
        self.internal_transfer(&sender_id, &receiver_id, amount.0, &memo);
    }

    /// Storage is paid by the game account, so every account counts as registered.
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

impl ChromaContract {
    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: &Option<String>) {
        require!(amount > 0, "Transfer amount must be positive");
        require!(from != to, "Sender and receiver cannot be the same");
        let from_balance = self.accounts.get(from).unwrap_or(0);
        require!(from_balance >= amount, "Insufficient balance");
        self.accounts.insert(from, &(from_balance - amount));
        let to_balance = self.accounts.get(to).unwrap_or(0);
        self.accounts.insert(to, &(to_balance + amount));
        transfer_event(from, to, amount, memo);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn game() -> AccountId {
        "game.testnet".parse().unwrap()
    }
    fn treasury() -> AccountId {
        "treasury.game.testnet".parse().unwrap()
    }
    fn merchant() -> AccountId {
        "merchant_ignis.game.testnet".parse().unwrap()
    }
    fn player() -> AccountId {
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90".parse().unwrap()
    }

    fn as_caller(id: AccountId, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(id).attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }

    fn fresh() -> ChromaContract {
        as_caller(game(), 0);
        ChromaContract::new(game(), vec![(treasury(), U128(7_000)), (merchant(), U128(3_000))])
    }

    fn mv(from: AccountId, to: AccountId, amount: u128, memo: &str) -> Move {
        Move { from, to, amount: U128(amount), memo: Some(memo.to_string()) }
    }

    #[test]
    fn genesis_matches_split() {
        let c = fresh();
        assert_eq!(c.ft_total_supply().0, 10_000);
        assert_eq!(c.ft_balance_of(treasury()).0, 7_000);
        assert_eq!(c.ft_balance_of(merchant()).0, 3_000);
        assert_eq!(c.ft_metadata().decimals, 0);
        assert!(get_logs()[0].contains("\"event\":\"ft_mint\""));
    }

    #[test]
    fn settle_applies_moves_in_order() {
        let mut c = fresh();
        c.settle(1, vec![
            mv(treasury(), player(), 100, "player_starting_grant tx_1"),
            mv(player(), merchant(), 30, "merchant_buy tx_2"),
        ]);
        assert_eq!(c.ft_balance_of(player()).0, 70);
        assert_eq!(c.ft_balance_of(merchant()).0, 3_030);
        assert_eq!(c.ft_balance_of(treasury()).0, 6_900);
        assert_eq!(c.ft_total_supply().0, 10_000);
        assert_eq!(c.last_batch(), 1);
        assert_eq!(get_logs().len(), 3);
    }

    #[test]
    #[should_panic(expected = "Batch out of order")]
    fn replayed_batch_is_refused() {
        let mut c = fresh();
        c.settle(1, vec![mv(treasury(), player(), 1, "a")]);
        c.settle(1, vec![mv(treasury(), player(), 1, "a")]);
    }

    #[test]
    #[should_panic(expected = "Only the game account settles")]
    fn only_owner_settles() {
        let mut c = fresh();
        as_caller(player(), 0);
        c.settle(1, vec![mv(treasury(), player(), 1, "a")]);
    }

    #[test]
    #[should_panic(expected = "Insufficient balance")]
    fn settle_cannot_overdraw() {
        let mut c = fresh();
        c.settle(1, vec![mv(player(), merchant(), 1, "a")]);
    }

    #[test]
    fn holder_can_transfer_with_one_yocto() {
        let mut c = fresh();
        c.settle(1, vec![mv(treasury(), player(), 50, "a")]);
        as_caller(player(), 1);
        c.ft_transfer(merchant(), U128(20), None);
        assert_eq!(c.ft_balance_of(player()).0, 30);
    }
}
