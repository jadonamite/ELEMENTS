import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { baseEncode, PublicKey, Signature, actions, buildDelegateAction, encodeDelegateAction } from 'near-api-js';
import { marketPayload, marketSigningBytes, marketQuote, marketTax, type MarketIntent, type SignedMarketIntent } from '@elements/shared';
import { getServerUrl, getStoredAuthToken } from '../auth/server-api.js';
import { guestKey } from '../auth/guest-key.js';
import './market-board.css';

type Offer = { id:string; owner:string; item:string; quantity:number; price:number; side:'buy'|'sell' };
interface Board { salt:string; verifier:string; coinToken:string; itemsContract:string; treasury:string; identity:{holder:string;publicKey:string}; offers:Offer[]; balances:Array<{token:string;amount:number;available:number}>; operations:Array<{id:string;kind:string;status:string;error:string|null}> }
async function api<T>(action:string,body:unknown = {}):Promise<T> {
  const response = await fetch(`${getServerUrl()}/api/market/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getStoredAuthToken()??''}`},body:JSON.stringify(body)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Could not reach the board'); return result;
}
function BoardPanel({close}:{close:()=>void}) {
  const { user } = usePrivy();
  const { signRawHash } = useSignRawHash();
  const [board,setBoard] = useState<Board|null>(null);
  const [message,setMessage] = useState('Reading the board…');
  const [busy,setBusy] = useState(false);
  const [item,setItem] = useState('shard_ignis');
  const [quantity,setQuantity] = useState(10);
  const [price,setPrice] = useState(100);
  const [amount,setAmount] = useState(10);
  const [asset,setAsset] = useState('CHROMA');
  async function refresh() { setBoard(await api<Board>('view')); setMessage(''); }
  useEffect(() => { void refresh().catch(error=>setMessage(String(error.message))); },[]);
  async function sign(hash:Uint8Array):Promise<Uint8Array> {
    if (!board) throw new Error('Read the board first');
    const address = board.identity.holder;
    const linked = user?.linkedAccounts.find(a=>a.type==='wallet' && a.chainType==='near' && a.address===address);
    if (linked) {
      const {signature} = await signRawHash({address,chainType:'near',hash:`0x${bytesToHex(hash)}`});
      return hexToBytes(signature.replace(/^0x/,''));
    }
    const guest = await guestKey();
    if (guest.accountId !== address) throw new Error('Sign in again to use the key holding your goods');
    return guest.signHash(hash);
  }
  async function signed(intents:MarketIntent[]):Promise<SignedMarketIntent> {
    if (!board) throw new Error('Read the board first');
    const payload = marketPayload(board.identity.holder,board.verifier,board.salt,intents);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(marketSigningBytes(payload))));
    return {standard:'nep413',payload,public_key:board.identity.publicKey,signature:`ed25519:${baseEncode(await sign(hash))}`};
  }
  async function run(fn:()=>Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage('The broker is recording your request…');
    try { await fn(); await refresh(); setMessage('Recorded. Refresh to see the broker’s next match.'); }
    catch(error) { setMessage(error instanceof Error?error.message:'Could not complete that request'); }
    finally { setBusy(false); }
  }
  const token = board ? asset==='CHROMA'?board.coinToken:`nep245:${board.itemsContract}:${item}` : '';
  async function deposit() {
    const quote = await api<{id:string;action:{sender:string;publicKey:string;contract:string;method:string;args:Record<string,unknown>;nonce:string;maxBlockHeight:string}}>('deposit-quote',{token,amount});
    const a=quote.action;
    const delegate=buildDelegateAction({senderId:a.sender,receiverId:a.contract,publicKey:PublicKey.fromString(a.publicKey),nonce:BigInt(a.nonce),maxBlockHeight:BigInt(a.maxBlockHeight),actions:[actions.functionCall(a.method,a.args,100_000_000_000_000n,1n)]});
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(encodeDelegateAction(delegate))));
    await api('deposit',{id:quote.id,signature:`ed25519:${baseEncode(await sign(hash))}`});
  }
  async function offer(side:'sell'|'buy', offer?:Offer) {
    const request={side,item:offer?.item??item,quantity:offer?.quantity??quantity,price:offer?.price??price,...(offer?{target:offer.id}:{})};
    const quote=await api<{intents:MarketIntent[]}>('offer-quote',{offer:request});
    await api('offer',{offer:request,signed:await signed(quote.intents)});
  }
  async function takeBack() {
    if (!board) return;
    const intent:MarketIntent = asset==='CHROMA'
      ? {intent:'ft_withdraw',token:board.coinToken.slice(7),receiver_id:board.identity.holder,amount:String(amount)}
      : {intent:'mt_withdraw',token:board.itemsContract,receiver_id:board.identity.holder,token_ids:[item],amounts:[String(amount)]};
    await api('return',{token,amount,signed:await signed([intent])});
  }
  let quote='';
  try { marketQuote(item,quantity,price); quote=`You give ${quantity} ${item} and receive ${price} CHROMA. The buyer pays the trade tax.`; } catch(error) {quote=(error as Error).message;}
  return <div className="market-board">
    <header><div><h2>Chromara market board</h2><p>The Dim broker matches signed offers.</p></div><button onClick={close}>Close</button></header>
    <p>Items move whole. The buyer pays the trade tax to the Lord’s treasury: {Math.round(marketTax(100,false))}% when either trader is Dim, {Math.round(marketTax(100,true))}% when both are Lit.</p>
    <p role="status" aria-live="polite">{message}</p>
    <fieldset disabled={busy||!board}><legend>Goods on the board</legend>
      <label>Item name<input value={item} onChange={e=>setItem(e.target.value)} autoComplete="off" /></label>
      <label>Good<select value={asset} onChange={e=>setAsset(e.target.value)}><option>CHROMA</option><option value="item">Selected item</option></select></label>
      <label>Amount<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label>
      <div className="market-actions"><button onClick={()=>void run(deposit)}>Put on board</button><button onClick={()=>void run(takeBack)}>Take back into game</button></div>
      <ul>{board?.balances.map(b=><li key={b.token}>{b.token===board.coinToken?'CHROMA':b.token.split(':').slice(2).join(':')}: {b.amount} on board, {b.available} available</li>)}</ul>
    </fieldset>
    <fieldset disabled={busy||!board}><legend>Offer items for CHROMA</legend>
      <label>Items given<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
      <label>Buyer’s CHROMA price<input type="number" min="1" step="1" inputMode="numeric" value={price} onChange={e=>setPrice(Number(e.target.value))}/></label>
      <p>{quote}</p><p>Offers expire after five minutes. Reserved goods become available again when an offer expires.</p>
      <button onClick={()=>void run(()=>offer('sell'))}>Post offer</button>
    </fieldset>
    <h3>Open offers</h3>
    {!board?.offers.some(o=>o.side==='sell')&&<p>No items are offered. Put goods on the board to post the first offer.</p>}
    <ul className="market-offers">{board?.offers.filter(o=>o.side==='sell').map(o=><li key={o.id}><p>{o.quantity} {o.item} for {o.price} CHROMA</p><p>You pay {o.price} CHROMA plus tax: {o.price+marketTax(o.price,false)} in all, or {o.price+marketTax(o.price,true)} if you and the seller are both Lit.</p><button disabled={busy} onClick={()=>void run(()=>offer('buy',o))}>Sign matching offer</button></li>)}</ul>
    {board?.operations.map(op=><p key={op.id}>{op.kind}: {op.status}{op.error?` · ${op.error}`:''}</p>)}
    <button disabled={busy} onClick={()=>void run(async()=>{})}>Refresh board</button>
    <footer><a href="/legal/terms.html">Terms</a><a href="/legal/privacy.html">Privacy</a><a href="/legal/cookies.html">Cookies</a></footer>
  </div>;
}
export function openMarketBoard() {
  const dialog=document.createElement('dialog'); dialog.className='market-dialog';
  document.body.append(dialog);
  const previous=document.activeElement as HTMLElement|null;
  const root=createRoot(dialog);
  const close=()=>{dialog.close();root.unmount();dialog.remove();previous?.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  const appId=import.meta.env.VITE_PRIVY_APP_ID as string|undefined;
  root.render(appId?<PrivyProvider appId={appId}><BoardPanel close={close}/></PrivyProvider>:<BoardPanelOffline close={close}/>);
  dialog.showModal();
}
function BoardPanelOffline({close}:{close:()=>void}) { return <div className="market-board"><h2>Chromara market board</h2><p>Sign in to the connected game to trade.</p><button onClick={close}>Close</button></div>; }
