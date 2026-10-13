# Oisy Wallet XRP — Attack Meta

**Target:** https://github.com/dfinity/oisy-wallet  
**Tip:** `2918274a65216bae1d6904ace7124f563b0a3aba` (`origin/main`, re-verified 2026-10-13)  
**XRP shipped:** v2.6.0–v2.6.2  
**Program:** HackenProof ICP — Oisy in-scope, High max  
**Prior audit:** Trail of Bits Sep 2025 — **before** native XRP; no XRP coverage

## Money path ranking

| Pri | Surface | Status |
| --- | --- | --- |
| 1 | Keys / Schnorr Ed25519 derivation + account binding | Killed — path caller-bound, SigningPubKey must derive `Account` |
| 1 | Signer UI ≠ payload (send review) | Review shows full destination; tag shown from same store signed |
| 1 | NEAR Intents deposit (Coreum–XRPL memo class) | Partially killed — quotes with `depositMemo` refused (v2.6.2); residual: send amount not rebound to signed `amountIn` |
| 2 | Destination tag / X-address / payment URI | **OPEN** — QR path drops tags; classic-only; advisory warning only |
| 2 | False expiry → duplicate send | Killed — `searched_all` + hash/range bind + recheck |
| 2 | Fee TOCTOU review→sign | Bounded (≤10_000 drops); observe freeze on SENDING |
| 3 | Address poison via known destinations | Weak — known dests are outbound sends only; list truncates; review is full |
| 3 | `Number(amountOut)` precision on NI receive UI | **OPEN** — display/slippage can disagree with signed quote |

## Invariants (hold / break)

1. Signing key ↔ classic address agreement — **holds** (`getXrpSigningPublicKey`)
2. One open XRP payment per address — **holds** (backend AUT + frontend gate)
3. Untagged send to `lsfRequireDestTag` refused — **holds**
4. Shown destination tag = signed `DestinationTag` — **holds** when tag entered in form
5. Payment URI / X-address tag reaches signed tx — **BROKEN** (never extracted)
6. Review receive amount = signed quote `amountOut` — **BROKEN** for large integer strings (`Number`)

## 10 takeover brainstorms

1. False expiry → resend drain — killed (`searched_all` + recheck)
2. Tag inherited across destination change — store clears on `sendDestination`; DESTINATION step syncs
3. Malicious RPC inflates balance / understates reserve — drops schema + max; send re-reads
4. NI deposit memo omitted → uncredited swap — killed for XRP offers with memo
5. NI quote amountOut display lie → user accepts bad trade — **open** (precision)
6. QR `dt=` dropped → exchange deposit lost — **open**
7. X-address paste → user strips to classic, loses tag — **open** (classic-only by design)
8. Fee poller raises fee between review and sign — max 0.01 XRP; still UI≠fee
9. Poison recent address via inbound dust — known dests exclude receives
10. Compromised 1Click quote key → forged depositAddress — Ostium class on third party (OOS unless Oisy binds poorly; signature verify present)

## Findings to file

| ID | Title | Sev | PoC |
| --- | --- | --- | --- |
| XRP-01 | Send QR ignores XRPL payment URIs / destination tags | High (fund loss) | `poc/xrp-01-qr-destination-tag.spec.ts` |
| XRP-02 | NEAR Intents receive amount via `Number()` loses precision | Med (UI≠signed quote) | `poc/xrp-02-near-intents-number.spec.ts` |
| XRP-03 | No X-address decode; contacts reject X-addresses | Med (fund loss UX) | documented + backend test already asserts reject |

## Dead ends (safe invariants)

- Sequence race open vs validated — takes max sequence
- `txnNotFound` without `searched_all` — indeterminate, not expiry
- Foreign `account_info` / `tx` hash mismatch — fail closed
- Deposit memo on XRP NI — filtered at offer + refuse at send
- **AUT Cross-principal forge** — `create`/`update`/`delete` keyed by `msg_caller()` only (`api/active_user_transactions.rs:30–76`); no controller path. Remote attacker cannot touch another principal's rows.
- **AUT Honest FE false-expiry (unpoisoned refs)** — `searched_all` + range/hash echo bind + validated-index recheck. Attack-meta prior kill stands for the *poller* given honest refs.
- **AUT Accidental FE dismiss of Pending** — UI gates dismiss to terminal only (`ActiveUserTransactionItem.svelte:195` `action={isFailed || isSucceeded ? closeAction : undefined}`). Backend `delete` remains open (Chain B).
- **AUT Non-user loader forge of terminal XRP** — `LoaderActiveUserTransactions` only drives `pollXrpActiveUserTransactions` for in-flight rows; NI poller explicitly skips `isXrpPaymentInFlight` (`Loader…:108–110`). `applyXrpStatus` attaches `ledger_result` refs **only** for NearIntents (`xrp-active-tx.services.ts:216–219`). No other service calls `update`/`delete` on plain `Xrp` rows. Terminal forge requires a same-principal `update`/`delete` (API, XSS, malicious client), not the honest poller inventing status without a lookup.

## AUT lock-bypass deep-dive (2026-10-13)

Known asymmetry confirmed: `leaves_pending_xrp_deposit` + `require_ledger_resolution` are NearIntents-only (`model.rs:673–681`, `:125–132`). Plain `Xrp` may go Pending→Failed/Succeeded with no `ledger_result`. `delete` is unrestricted. `update` replaces `external_refs` wholesale after shape-only `require_xrp_refs`.

| Chain | Verdict | Impact | Sev (HP High-max) |
| --- | --- | --- | --- |
| **A** Plain Xrp Pending→Failed/Succeeded w/o ledger_result → second create Allowed | **PROVEN** (unit test `xrp_second_send_allowed_once_the_first_is_terminal`; intentional per `ledger_result_is_required_of_xrp_source_swaps_only`) | Same-principal unlock while payment may still apply | **Low** (ICPBB-120 class) |
| **B** delete(Pending Xrp) → second create Allowed | **PROVEN** (`xrp_delete_pending_unlocks_second_create`). FE dismiss gated; canister is not. | Same-principal | **Low** |
| **C** update Pending `last_ledger_sequence`→`1` → poller false-expires → Failed → second send | **PROVEN backend half** (`xrp_update_can_poison_last_ledger_sequence_while_pending`; NI variant `xrp_swap_poisoned_lls_then_expired_unlocks_create`). Poller trusts stored LLS (`xrp-active-tx.services.ts:59–64`, `:105–155`). | Same-principal; needs deliberate ref rewrite then honest poller | **Low** (defense-in-depth gap; no remote) |
| **D** Cross-tab/device status/ref races | **Mostly held.** Dual create: FE gate TOCTOU, backend `AlreadyInFlight` atomic (`model.rs:66–68`). Dual poller terminal writes: terminal transitions idempotent. Cross-device: Device A forges Failed → Device B retries — same as A (same principal). | Same-principal only | Not a separate High |

**Why not High:** Caller-bound; XRPL sequence still prevents two applied payments for the same `Sequence`. Closest paid class is ICPBB-120 (BTC pending prune bypass) = **Low** — self-affecting reservation-guard bypass. A High would need a non-caller path that forges terminal status or poisons refs.

**Residual hardening (not a bounty win alone):** require `ledger_result` for plain `Xrp` leaving Pending (mirror NI); reject `delete` while `holds_xrp_address`; freeze `tx_hash` / `last_ledger_sequence` after create (updates may only *add* `ledger_result`).
