# Oisy Wallet XRP — Attack Meta

**Target:** https://github.com/dfinity/oisy-wallet (latest `main` @ `2918274a`, XRP shipped v2.6.0–v2.6.2)  
**Program:** HackenProof ICP — Oisy in-scope, High max  
**Prior audit:** Trail of Bits Sep 2025 — **before** native XRP; no XRP coverage  
**Date:** 2026-10-13

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
