# Oisy Wallet — XRP findings (latest main)

**Repo:** `dfinity/oisy-wallet`  
**Tip verified:** `2918274a65216bae1d6904ace7124f563b0a3aba` (`origin/main`, 2026-10-13)  
**Scope:** HackenProof ICP / Oisy  
**ToB Sep 2025:** no XRP (feature shipped Oct 2026)  
**Re-check:** all three issues still present on tip; PoCs `7/7` green

---

## XRP-01 — High — Send QR drops XRPL destination tags

### Impact

User scans an XRPL payment request that includes a destination tag (`xrpl:r…?dt=N` or `r…?dt=N`). Oisy either rejects the string as an invalid classic address or the user pastes only the classic address. The payment is signed **without** `DestinationTag`. On exchange / shared accounts that do **not** set `lsfRequireDestTag`, XRPL accepts the payment and the exchange cannot auto-credit — funds are effectively lost (manual recovery at best).

This is the wallet-owned half of the classic XRP deposit-tag fund-loss class (Kerberus paste / consent surface). Oisy warns on review when a tag is missing, but the QR path never offers the tag that was in the request.

### Root cause

`decodeQrCode` (`src/frontend/src/lib/utils/qr-code.utils.ts`) only parses ICRC `decodePayment`. Non-ICRC codes become `{ destination: code }` with **no** tag field. `SendQrCodeScan` only copies `destination` / `amount` into the send form — never `sendXrpDestinationTag`.

`decodeQrCodeUrn` already parses `dt` via catchall and can return `{ destination: classic, dt: N }`, but the XRP send QR path never calls it.

```94:124:oisy-wallet/src/frontend/src/lib/utils/qr-code.utils.ts
export const decodeQrCode = ({ status, code, expectedToken }): QrResponse => {
	// ...
	const payment = decodePayment(code);
	if (isNullish(payment)) {
		return { status: 'success', destination: code };
	}
	// ...
};
```

Broken assumption: *scanned payment request bytes ≡ reviewed/signed destination routing.*

### PoC

```bash
cd /workspace
npx vitest run --config oisy-wallet/vitest.config.ts poc/xrp-01-qr-destination-tag.spec.ts
```

Asserts: URI/`?dt=` land as invalid destination strings; URN helper extracts `dt` that the send path ignores.

### Minimal fix

1. For XRP expected token, run `decodeQrCodeUrn` / XLS-0002 parse on scanned text.
2. Set classic address as destination and `sendXrpDestinationTag.set(dt)`.
3. Decode X-addresses to classic + tag (or refuse with an explicit “tag required” copy).
4. Extend `QrResponse` with optional `destinationTag`.

---

## XRP-02 — Medium — NEAR Intents receive amount via `Number()` (UI ≠ signed quote)

### Impact

On XRP→EVM/NEAR swaps, review shows `receiveAmount` / `receiveOutMinimum` derived with `Number()`, which is not exact above `2^53−1`. The 1Click signature still covers the true string `amountOut` / `minAmountOut`. User can confirm a **different** receive / slippage floor than the authenticated quote (signer-UI mismatch class).

### Root cause

```226:232:oisy-wallet/src/frontend/src/lib/utils/swap.utils.ts
export const mapNearIntentsQuoteResult = (quote: NearIntentsQuoteResponse): SwapMappedResult => ({
	provider: SwapProvider.NEAR_INTENTS,
	receiveAmount: BigInt(Math.floor(Number(quote.quote.amountOut))),
	receiveOutMinimum: nonNullish(quote.quote.minAmountOut)
		? BigInt(Math.floor(Number(quote.quote.minAmountOut)))
		: undefined,
	swapDetails: quote
});
```

Broken assumption: *`Number(decimalString)` preserves the full integer for display and slippage.*

### PoC

```bash
npx vitest run --config oisy-wallet/vitest.config.ts poc/xrp-02-near-intents-number.spec.ts
```

### Minimal fix

`BigInt(quote.quote.amountOut)` / `BigInt(minAmountOut)` after validating `/^\d+$/`.

---

## XRP-03 — Medium — Classic-only addresses; X-addresses rejected

Backend `XrpAddress` / contacts reject X-addresses (`test_update_contact_rejects_an_xrp_x_address`). X-addresses embed destination tags. Users who convert X→classic out-of-band often drop the tag → same fund-loss as XRP-01. Intentional limitation, but combined with XRP-01 it is a systemic destination-tag gap on a brand-new chain.

### Minimal fix

Decode X-address → classic + tag in send/contacts; store tag with contact.

---

## Surfaces hunted and closed

| Class | Result |
| --- | --- |
| False expiry / double-send | Closed — `searched_all` + range/hash bind + validated-ledger recheck |
| RequireDest fee burn | Closed — dual ledger flag read, refuse untagged |
| NI deposit memo (Coreum bridge class) | Closed for XRP — offers filtered + send refuses |
| Tag inheritance across recipients | Closed when DESTINATION step runs (`sendDestination` sync) |
| Signing key ≠ account | Closed — derive-and-compare before sign |
| Known-dest inbound poison | Closed — known dests are outbound sends only |
| AUT lock forge (A/B/C/D) | **Same-principal only** — see below; not High |

---

## XRP-AUT — Low (do not file as High) — Same-principal in-flight lock bypass

### Verdict

Chains **A/B/C are real** against the caller's own AUT rows. **No remote / cross-principal path.** Matches HackenProof **ICPBB-120** class (BTC pending-tx prune bypass → **Low**): self-affecting reservation-guard bypass; XRPL `Sequence` still prevents two applied payments for one nonce.

### Asymmetry (root)

```673:681:oisy-wallet/src/backend/src/active_user_transactions/model.rs
fn leaves_pending_xrp_deposit(...) -> bool {
    matches!(current.data, ActiveUserTransactionData::NearIntents(_))
        && xrp_payment_source(&current.data).is_some()
        && current.status == Pending
        && *to != Pending
}
```

Plain `Xrp` skips `require_ledger_resolution`. `delete` has no status gate (`model.rs:154–161`). `update` replaces `external_refs` after shape-only `require_xrp_refs` (`:107–116`, `:631–668` — `last_ledger_sequence` may be `"1"`).

### Frontend

- `applyXrpStatus` attaches `ledger_result` refs **only** for NearIntents (`xrp-active-tx.services.ts:216–219`).
- Dismiss UI: terminal only (`ActiveUserTransactionItem.svelte:195`).
- Loader: NI poller skips in-flight XRP deposits (`LoaderActiveUserTransactions.svelte:108–110`); no non-user path forges terminal plain-Xrp status.

### Proof

```bash
cd oisy-wallet && cargo test -p backend --lib -- \
  xrp_second_send_allowed_once_the_first_is_terminal \
  xrp_delete_pending_unlocks_second_create \
  xrp_update_can_poison_last_ledger_sequence_while_pending \
  xrp_swap_poisoned_lls_then_expired_unlocks_create
```

### Recommended severity

**Low** / Informational for HackenProof High-max. Do not escalate unless a non-caller write path appears.
