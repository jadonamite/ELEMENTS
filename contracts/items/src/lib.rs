//! NEP-245 multi-token balances for ELEMENTS item stacks.

use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey { Balances, Supplies }

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MtOp {
    pub from: Option<AccountId>,
    pub to: Option<AccountId>,
    pub token_id: String,
    pub amount: U128,
    pub memo: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MtContractMetadata { pub spec: String, pub name: String }

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MtBaseTokenMetadata {
    pub name: String, pub id: String, pub symbol: Option<String>, pub icon: Option<String>,
    pub decimals: Option<String>, pub base_uri: Option<String>, pub reference: Option<String>,
    pub copies: Option<u64>, pub reference_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MtTokenMetadata {
    pub title: Option<String>, pub description: Option<String>, pub media: Option<String>,
    pub media_hash: Option<String>, pub issued_at: Option<String>, pub expires_at: Option<String>,
    pub starts_at: Option<String>, pub updated_at: Option<String>, pub extra: Option<String>,
    pub reference: Option<String>, pub reference_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct MtTokenMetadataAll { pub base: MtBaseTokenMetadata, pub token: MtTokenMetadata }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ItemsContract {
    owner_id: AccountId,
    balances: LookupMap<String, u128>,
    supplies: LookupMap<String, u128>,
    last_batch: u64,
}

fn key(account: &AccountId, token: &str) -> String { format!("{account}\0{token}") }

fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard":"nep245","version":"1.0.0","event":name,"data":data})));
}

#[near]
impl ItemsContract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");
        Self { owner_id, balances: LookupMap::new(StorageKey::Balances), supplies: LookupMap::new(StorageKey::Supplies), last_batch: 0 }
    }

    pub fn owner(&self) -> AccountId { self.owner_id.clone() }
    pub fn last_batch(&self) -> u64 { self.last_batch }

    /// Ordered server ledger operations. `from: None` mints from world; `to: None` burns to world.
    pub fn settle(&mut self, batch: u64, ops: Vec<MtOp>) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the game account settles");
        require!(batch == self.last_batch + 1, "Batch out of order");
        for op in ops {
            require!(op.amount.0 > 0, "Amount must be positive");
            let token = op.token_id;
            let amount = op.amount.0;
            match (op.from, op.to) {
                (None, Some(to)) => {
                    let balance=self.balances.get(&key(&to,&token)).unwrap_or(0);
                    self.balances.insert(&key(&to,&token), &(balance+amount));
                    let supply=self.supplies.get(&token).unwrap_or(0);
                    self.supplies.insert(&token,&(supply+amount));
                    event("mt_mint",json!([{"owner_id":to,"token_ids":[token],"amounts":[amount.to_string()],"memo":op.memo}]));
                },
                (Some(from), None) => {
                    let balance=self.balances.get(&key(&from,&token)).unwrap_or(0);
                    require!(balance>=amount,"Insufficient balance");
                    self.balances.insert(&key(&from,&token),&(balance-amount));
                    let supply=self.supplies.get(&token).unwrap_or(0);
                    require!(supply>=amount,"Supply underflow");
                    self.supplies.insert(&token,&(supply-amount));
                    event("mt_burn",json!([{"owner_id":from,"token_ids":[token],"amounts":[amount.to_string()],"memo":op.memo}]));
                },
                (Some(from),Some(to)) => self.transfer(&from,&to,&token,amount,op.memo),
                (None,None) => env::panic_str("Operation has no source or destination"),
            }
        }
        self.last_batch = batch;
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 { U128(self.balances.get(&key(&account_id, &token_id)).unwrap_or(0)) }
    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|token| self.mt_balance_of(account_id.clone(), token.clone())).collect()
    }
    pub fn mt_supply(&self, token_id: String) -> Option<U128> { self.supplies.get(&token_id).map(U128) }
    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> { token_ids.into_iter().map(|t| self.mt_supply(t)).collect() }
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<near_sdk::serde_json::Value>> {
        token_ids.into_iter().map(|token_id| self.supplies.get(&token_id).map(|_| json!({
            "token_id":token_id,"owner_id":null,"base_metadata_id":token_id,
            "token_metadata":self.token_metadata(&token_id)
        }))).collect()
    }
    pub fn mt_metadata_contract(&self) -> MtContractMetadata { MtContractMetadata { spec:"mt-1.0.0".into(), name:"ELEMENTS Items".into() } }
    pub fn mt_metadata_base_by_token_id(&self, token_ids: Vec<String>) -> Vec<MtBaseTokenMetadata> {
        token_ids.iter().map(|id| self.base_metadata(id)).collect()
    }
    pub fn mt_metadata_base_by_metadata_id(&self, metadata_ids: Vec<String>) -> Vec<MtBaseTokenMetadata> {
        metadata_ids.iter().map(|id| self.base_metadata(id)).collect()
    }
    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<String>) -> Vec<MtTokenMetadata> {
        token_ids.iter().map(|id| self.token_metadata(id)).collect()
    }
    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<MtTokenMetadataAll> {
        token_ids.iter().map(|id| MtTokenMetadataAll { base:self.base_metadata(id), token:self.token_metadata(id) }).collect()
    }
}

impl ItemsContract {
    fn base_metadata(&self, token_id: &str) -> MtBaseTokenMetadata {
        let name = token_name(token_id);
        MtBaseTokenMetadata { name, id:token_id.into(), symbol:None, icon:None, decimals:None, base_uri:None, reference:None, copies:Some(self.supplies.get(&token_id.to_string()).unwrap_or(0).min(u64::MAX as u128) as u64), reference_hash:None }
    }

    fn token_metadata(&self, token_id: &str) -> MtTokenMetadata {
        let element = ["ignis", "aques", "terra", "aura"].into_iter().find(|name| token_id.ends_with(name)).unwrap_or("none");
        let media = if token_id.starts_with("shard_") && element != "none" { format!("https://elements.namite.xyz/assets/ui/hud/shard-{element}.png") } else { "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 4 53 20 48 50 32 60 16 50 11 20z' fill='%23b8862b'/%3E%3Cpath d='M32 9v45' stroke='%23f3d27a' stroke-width='4'/%3E%3C/svg%3E".to_string() };
        MtTokenMetadata { title:Some(token_name(token_id)), description:Some(format!("ELEMENTS item token: {token_id}")), media:Some(media), media_hash:None, issued_at:None, expires_at:None, starts_at:None, updated_at:None, extra:Some(json!({"element":element,"token_id":token_id}).to_string()), reference:None, reference_hash:None }
    }
}

fn token_name(token_id: &str) -> String {
    token_id.split('_').map(|part| { let mut chars=part.chars(); chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default() }).collect::<Vec<_>>().join(" ")
}

#[near]
impl ItemsContract {
    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "Approvals are not supported");
        self.transfer(&env::predecessor_account_id(), &receiver_id, &token_id, amount.0, memo);
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        assert_one_yocto();
        require!(token_ids.len() == amounts.len(), "Token and amount lengths differ");
        if let Some(ref values) = approvals {
            require!(values.len() == token_ids.len(), "Token and approval lengths differ");
            require!(values.iter().all(Option::is_none), "Approvals are not supported");
        }
        let sender = env::predecessor_account_id();
        for (token, amount) in token_ids.iter().zip(amounts.iter()) { self.transfer(&sender, &receiver_id, token, amount.0, memo.clone()); }
    }
}

impl ItemsContract {
    fn transfer(&mut self, from: &AccountId, to: &AccountId, token: &str, amount: u128, memo: Option<String>) {
        require!(amount > 0, "Amount must be positive");
        require!(from != to, "Sender and receiver cannot be the same");
        let source = self.balances.get(&key(from, token)).unwrap_or(0);
        require!(source >= amount, "Insufficient balance");
        self.balances.insert(&key(from, token), &(source - amount));
        let target = self.balances.get(&key(to, token)).unwrap_or(0);
        self.balances.insert(&key(to, token), &(target + amount));
        event("mt_transfer", json!([{"old_owner_id":from,"new_owner_id":to,"token_ids":[token],"amounts":[amount.to_string()],"memo":memo}]));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};
    fn id(v:&str)->AccountId { v.parse().unwrap() }
    fn caller(v:&str, deposit:u128) { testing_env!(VMContextBuilder::new().predecessor_account_id(id(v)).attached_deposit(NearToken::from_yoctonear(deposit)).build()); }
    fn contract()->ItemsContract { caller("elements.testnet",0); ItemsContract::new(id("elements.testnet")) }
    fn op(from:Option<&str>, to:Option<&str>, token:&str, amount:u128)->MtOp { MtOp{from:from.map(id),to:to.map(id),token_id:token.into(),amount:U128(amount),memo:None} }
    #[test] fn mint_transfer_burn_supply() {
        let mut c=contract();
        c.settle(1,vec![op(None,Some("world.elements.testnet"),"potion",10)]);
        assert_eq!(c.mt_supply("potion".into()).unwrap().0,10);
        c.settle(2,vec![op(Some("world.elements.testnet"),Some("alice.testnet"),"potion",4)]);
        assert_eq!(c.mt_balance_of(id("alice.testnet"),"potion".into()).0,4);
        c.settle(3,vec![op(Some("world.elements.testnet"),None,"potion",3)]);
        assert_eq!(c.mt_balance_of(id("world.elements.testnet"),"potion".into()).0,3);
        assert_eq!(c.mt_supply("potion".into()).unwrap().0,7);
    }
    #[test] #[should_panic(expected="Batch out of order")] fn rejects_replay(){ let mut c=contract(); c.settle(1,vec![]); c.settle(1,vec![]); }
    #[test] #[should_panic(expected="Only the game account settles")] fn owner_only(){let mut c=contract(); caller("other.testnet",0);c.settle(1,vec![]);}
    #[test] #[should_panic(expected="Insufficient balance")] fn refuses_overdraw(){let mut c=contract(); c.settle(1,vec![op(None,Some("world.elements.testnet"),"potion",1)]); c.settle(2,vec![op(Some("world.elements.testnet"),None,"potion",2)]);}
}
