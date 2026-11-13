use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TransferReceiver {
    token_contract_id: AccountId,
}

#[near]
impl TransferReceiver {
    #[init]
    pub fn new(token_contract_id: AccountId) -> Self {
        Self { token_contract_id }
    }

    pub fn mt_on_transfer(
        &self,
        _sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> Vec<U128> {
        require!(env::predecessor_account_id() == self.token_contract_id, "Untrusted token contract");
        require!(previous_owner_ids.len() == token_ids.len(), "Previous owner and token lengths differ");
        require!(token_ids.len() == amounts.len(), "Token and amount lengths differ");

        amounts.into_iter().map(|amount| match msg.as_str() {
            "keep_all" => U128(0),
            "keep_part" => U128(amount.0 / 2),
            "keep_none" => amount,
            _ => amount,
        }).collect()
    }
}
