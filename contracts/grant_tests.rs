use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PublicKey};
use near_sdk::json_types::{Base64VecU8};
use near_sdk::serde_json::json;

fn context(time: u64, caller: &str) {
    testing_env!(VMContextBuilder::new().current_account_id("token.testnet".parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap()).block_timestamp(time).build());
}
fn key() -> SigningKey { SigningKey::from_bytes(&[7; 32]) }
fn implicit() -> AccountId { key().verifying_key().as_bytes().iter().map(|v| format!("{v:02x}")).collect::<String>().parse().unwrap() }
fn signed(holder: AccountId, expires: u64) -> (Payload, PublicKey, Base64VecU8) {
    let payload = Payload {
        message: json!({"holder_id":holder,"expires_at":expires.to_string(),"caps":{"CHROMA":"40","potion":"4"},"rules":"elements-session-v1"}).to_string(),
        nonce: [1;32], recipient: "token.testnet".into(), callback_url: None,
    };
    let encoded = near_sdk::borsh::to_vec(&((1u32<<31)+413, &payload)).unwrap();
    let signature = key().sign(&env::sha256(&encoded)).to_bytes().to_vec();
    let public_key = PublicKey::from_parts(near_sdk::CurveType::ED25519, key().verifying_key().to_bytes().to_vec()).unwrap();
    (payload, public_key, Base64VecU8(signature))
}
fn fresh() -> Grants { context(1,"courier.testnet"); Grants::new() }
fn grant(book: &mut Grants) { let (p,k,s)=signed(implicit(),100); book.grant(p,k,s); }

#[test] #[should_panic(expected="No live grant")]
fn unsigned_debit_refused() { fresh().debit(&implicit(),"CHROMA",1); }
#[test] #[should_panic(expected="Grant expired")]
fn expired_grant_refused() { let mut b=fresh(); grant(&mut b); context(100,"courier.testnet"); b.debit(&implicit(),"CHROMA",1); }
#[test] #[should_panic(expected="Grant cap exceeded")]
fn debit_over_cap_refused() { let mut b=fresh(); grant(&mut b); b.debit(&implicit(),"CHROMA",41); }
#[test]
fn involuntary_debits_inside_cap_pass() { let mut b=fresh(); grant(&mut b); b.debit(&implicit(),"CHROMA",16); b.debit(&implicit(),"CHROMA",24); assert_eq!(b.get(&implicit()).unwrap().caps["CHROMA"].0,0); }
#[test] #[should_panic(expected="Grant nonce already used")]
fn replayed_nonce_refused() { let mut b=fresh(); grant(&mut b); grant(&mut b); }
#[test] #[should_panic(expected="Wrong holder key")]
fn wrong_key_refused() { let mut b=fresh(); let (p,k,s)=signed("victim.testnet".parse().unwrap(),100); b.grant(p,k,s); }
#[test] #[should_panic(expected="Invalid grant signature")]
fn changed_terms_refused() { let mut b=fresh(); let (mut p,k,s)=signed(implicit(),100); p.message=p.message.replace("40","400"); b.grant(p,k,s); }
#[test] #[should_panic(expected="Wrong recipient")]
fn cross_contract_replay_refused() { let mut b=fresh(); let (mut p,k,s)=signed(implicit(),100); p.recipient="other.testnet".into(); b.grant(p,k,s); }
#[test] #[should_panic(expected="Token not granted")]
fn unlisted_item_refused() { let mut b=fresh(); grant(&mut b); b.debit(&implicit(),"sword",1); }
#[test]
fn named_holder_registers_own_key() { let mut b=fresh(); let holder="treasury.testnet"; let(p,k,s)=signed(holder.parse().unwrap(),100); context(1,holder); b.register(k.clone()); context(1,"courier.testnet"); b.grant(p,k,s); b.debit(&holder.parse().unwrap(),"CHROMA",1); }
#[test] #[should_panic(expected="Key already registered")]
fn registration_is_once() { let mut b=fresh(); let(_,k,_)=signed(implicit(),100); b.register(k.clone()); b.register(k); }

#[test] #[should_panic(expected="Implicit accounts use their own key")]
fn implicit_holder_cannot_register_an_alternate_key() {
    let mut b=fresh(); let(_,k,_)=signed(implicit(),100);
    context(1,implicit().as_str()); b.register(k);
}
