use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, PanicOnDefault,
};

use near_sdk::serde::{Deserialize, Serialize};

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

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ChromaContract {
    pub owner_id: AccountId,
    pub total_supply: u128,
    pub accounts: LookupMap<AccountId, u128>,
    pub metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl ChromaContract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");

        let total_supply: u128 = 10_000_000;
        let mut accounts = LookupMap::new(StorageKey::Accounts);
        accounts.insert(&owner_id, &total_supply);

        let metadata = FungibleTokenMetadata {
            spec: "ft-1.0.0".to_string(),
            name: "CHROMA".to_string(),
            symbol: "CHROMA".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 0,
        };

        Self {
            owner_id,
            total_supply,
            accounts,
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        }
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.accounts.get(&account_id).unwrap_or(0))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let sender_id = env::predecessor_account_id();
        let amount_raw = amount.0;
        require!(amount_raw > 0, "Transfer amount must be positive");
        require!(sender_id != receiver_id, "Sender and receiver cannot be the same");

        let sender_balance = self.accounts.get(&sender_id).unwrap_or(0);
        require!(sender_balance >= amount_raw, "Insufficient balance");

        self.accounts.insert(&sender_id, &(sender_balance - amount_raw));
        let receiver_balance = self.accounts.get(&receiver_id).unwrap_or(0);
        self.accounts.insert(&receiver_id, &(receiver_balance + amount_raw));

        env::log_str(&format!(
            "Transfer {} CHROMA from {} to {}{}",
            amount_raw,
            sender_id,
            receiver_id,
            memo.map(|m| format!(" ({})", m)).unwrap_or_default()
        ));
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn treasury() -> AccountId {
        "treasury.elements.near".parse().unwrap()
    }

    fn alice() -> AccountId {
        "alice.near".parse().unwrap()
    }

    fn bob() -> AccountId {
        "bob.near".parse().unwrap()
    }

    #[test]
    fn test_initialization() {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(treasury());
        testing_env!(builder.build());

        let contract = ChromaContract::new(treasury());
        assert_eq!(contract.ft_total_supply().0, 10_000_000);
        assert_eq!(contract.ft_balance_of(treasury()).0, 10_000_000);
        assert_eq!(contract.ft_balance_of(alice()).0, 0);

        let meta = contract.ft_metadata();
        assert_eq!(meta.symbol, "CHROMA");
        assert_eq!(meta.decimals, 0);
    }

    #[test]
    fn test_transfer_success() {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(treasury());
        testing_env!(builder.build());

        let mut contract = ChromaContract::new(treasury());

        contract.ft_transfer(alice(), U128(100), Some("Player starting grant".to_string()));
        assert_eq!(contract.ft_balance_of(treasury()).0, 9_999_900);
        assert_eq!(contract.ft_balance_of(alice()).0, 100);
        assert_eq!(contract.ft_total_supply().0, 10_000_000);

        // Alice transfers to Bob
        builder.predecessor_account_id(alice());
        testing_env!(builder.build());

        contract.ft_transfer(bob(), U128(40), Some("Trade payment".to_string()));
        assert_eq!(contract.ft_balance_of(alice()).0, 60);
        assert_eq!(contract.ft_balance_of(bob()).0, 40);
        assert_eq!(contract.ft_total_supply().0, 10_000_000);
    }

    #[test]
    #[should_panic(expected = "Insufficient balance")]
    fn test_transfer_insufficient_balance() {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(alice());
        testing_env!(builder.build());

        let mut contract = ChromaContract::new(treasury());
        contract.ft_transfer(bob(), U128(500), None);
    }
}
