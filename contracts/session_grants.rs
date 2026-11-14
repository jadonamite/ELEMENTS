use std::collections::BTreeMap;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, require, AccountId, PublicKey};

#[derive(BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Payload {
    pub message: String,
    pub nonce: [u8; 32],
    pub recipient: String,
    pub callback_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Terms {
    pub holder_id: AccountId,
    pub expires_at: U64,
    pub caps: BTreeMap<String, U128>,
    pub rules: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Grant {
    pub caps: BTreeMap<String, U128>,
    pub expires_at: U64,
    pub nonce: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Grants {
    keys: LookupMap<AccountId, PublicKey>,
    grants: LookupMap<AccountId, Grant>,
    used: LookupSet<(AccountId, [u8; 32])>,
}

fn is_implicit(holder: &AccountId) -> bool {
    holder.as_str().len() == 64 && holder.as_bytes().iter().all(u8::is_ascii_hexdigit)
}

impl Grants {
    pub fn new() -> Self {
        Self { keys: LookupMap::new(b"grant_keys".to_vec()), grants: LookupMap::new(b"grants".to_vec()), used: LookupSet::new(b"grant_nonces".to_vec()) }
    }

    pub fn register(&mut self, public_key: PublicKey) {
        let holder = env::predecessor_account_id();
        require!(!is_implicit(&holder), "Implicit accounts use their own key");
        require!(public_key.as_bytes().len() == 33, "Ed25519 key required");
        require!(self.keys.get(&holder).is_none(), "Key already registered");
        self.keys.insert(&holder, &public_key);
    }

    pub fn grant(&mut self, payload: Payload, public_key: PublicKey, signature: Base64VecU8) {
        require!(payload.recipient == env::current_account_id().as_str(), "Wrong recipient");
        require!(payload.callback_url.is_none(), "Callbacks are not supported");
        let terms: Terms = near_sdk::serde_json::from_str(&payload.message).expect("Invalid grant terms");
        require!(terms.rules == "elements-session-v1", "Game rules must be accepted");
        require!(terms.expires_at.0 > env::block_timestamp(), "Grant expired");
        require!(!terms.caps.is_empty(), "Empty grant");
        require!(!self.used.contains(&(terms.holder_id.clone(), payload.nonce)), "Grant nonce already used");
        let bytes = public_key.as_bytes();
        require!(bytes.len() == 33, "Ed25519 key required");
        let implicit: String = bytes[1..].iter().map(|v| format!("{v:02x}")).collect();
        require!(terms.holder_id.as_str() == implicit || (!is_implicit(&terms.holder_id) && self.keys.get(&terms.holder_id).as_ref() == Some(&public_key)), "Wrong holder key");
        let encoded = near_sdk::borsh::to_vec(&((1u32 << 31) + 413, &payload)).expect("Payload serializes");
        let hash = env::sha256(&encoded);
        let sig: [u8; 64] = signature.0.try_into().expect("Invalid signature length");
        let key: [u8; 32] = bytes[1..].try_into().unwrap();
        require!(env::ed25519_verify(&sig, &hash, &key), "Invalid grant signature");
        self.used.insert(&(terms.holder_id.clone(), payload.nonce));
        self.grants.insert(&terms.holder_id, &Grant { caps: terms.caps, expires_at: terms.expires_at, nonce: payload.nonce });
    }

    pub fn get(&self, holder: &AccountId) -> Option<Grant> { self.grants.get(holder) }

    pub fn debit(&mut self, holder: &AccountId, token: &str, amount: u128) {
        let mut grant = self.grants.get(holder).expect("No live grant");
        require!(env::block_timestamp() < grant.expires_at.0, "Grant expired");
        let cap = grant.caps.get_mut(token).expect("Token not granted");
        require!(cap.0 >= amount, "Grant cap exceeded");
        cap.0 -= amount;
        self.grants.insert(holder, &grant);
    }
}

#[cfg(test)]
impl Grants {
    pub fn fixture(&mut self, holder: AccountId, token: &str, cap: u128) {
        self.grants.insert(&holder, &Grant { caps: [(token.into(), U128(cap))].into(), expires_at: U64(u64::MAX), nonce: [0;32] });
    }
}

#[cfg(test)]
#[path = "grant_tests.rs"]
mod tests;
