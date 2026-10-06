# Heimdall-v2 attack dossier (Polygon Immunefi)

Authorized: Polygon Immunefi · asset `0xPolygon/heimdall-v2` latest published release.  
Target tag: **v0.12.1** (`6e432e2d`). Lugano live (mainnet ~54.6M).  
Prior run: recovery-byte freeze **KILLED**. Do not re-file.

Max: $250k Critical (10% funds, min $20k). High flat $10k. PoC + KYC required.  
OOS: unmodified upstream; >1/3 BFT / 51%; admin/gov without privilege escalation; mainnet testing; known Kyoto recovery-byte stall.

## Money ranking (2026 meta → this target)

1. Keys/ops: single bridge relayer is policy not trust root — L1 `submitCheckpoint` is permissionless.  
2. Forged L1-bound message (Kelp/Verus class): checkpoint bytes, ack receipt, clerk event → mint/exit.  
3. UI≠payload: N/A.  
4. Thin-collateral: N/A.  
5. Code/halt: vote-ext panic, PreBlocker skew, ante nest, wall-clock cache — chain toward freeze/halt.

## Invariants

I1. L1 checkpoint payload + sigs ⇒ honest Heimdall majority on those side-sign bytes.  
I2. `MsgCpAck` advances only after RootChain header matches (with intentional endBlock adjust).  
I3. Clerk StateSync cannot mint without real StateSender log; Lugano persists normalized contract.  
I4. Milestone cannot be replayed as checkpoint; parent bound at Zurich.  
I5. Vote-ext verify ≈ apply at same height (Ithaca latest-head fields gated).  
I6. Ante + side-tx one-msg; AccountRootHash len at Zurich; clerk TxHash at Lugano.  
I7. Stake power from amount; `BigInt()` copies so in-place Div cannot desync msg.  
I8. Recovery byte outside allow-list cannot freeze L1 (omit works).

## Brainstorm status

| # | Path | Status |
| --- | --- | --- |
| 1 | Recovery-byte batch abort freezes exits | **KILLED** (prior) |
| 2 | Fake/weak `MsgCpAck` | **KILLED** — L1 header match required |
| 3 | Clerk codec / UnpackLog / homoglyph | **KILLED** — Lugano normalize |
| 4 | Topup user homoglyph wrong credit | **KILLED** — decode family agrees; BigInt copy |
| 5 | Milestone↔checkpoint side-sign residual | **KILLED** — milestone side-sign nil historically; parent Zurich |
| 6 | VerifyVoteExt vs PreBlocker height skew | **KILLED** for Ithaca fields / milestoneCtx.WithBlockHeight |
| 7 | Gov/Any nested ante bypass | Open lightly — nested MsgCheckpoint not seen as side-tx; gov path still validates account root |
| 8 | Side-tx post-handler lag / NoAck grief | Not profitable alone |
| 9 | Span/producer selection bias | Low unless permissionless drain |
| 10 | CometBFT sync DoS residual | Open — Polygon blocksync budget present in v0.3.9-polygon |
| 11 | IsValidCheckpoint TTL cache ACCEPT/REJECT split | **PRIMITIVE** — needs halt PoC |
| 12 | Tx-hash padding collision | **KILLED** at Lugano |

## Killed this session

- Topup homoglyph credit theft (`x/topup/keeper/side_msg_server.go` + `cosmossdk.io/math.Int.BigInt` copy).  
- Ack without L1 (`SideHandleMsgCheckpointAck` + `GetHeaderInfo`).  
- Clerk tx-hash short-form collision under Lugano `IsValidTxHash`.  
- Dividend case-key split (`FormatAddress`).  
- `GetPowerFromAmount` desync via `ValidateVotingPower` then amount `Cmp` (copy).

## Primitives (chainable)

- P1: `rootCache`/`existsCache` 10s wall TTL in `IsValidCheckpoint` (also ProcessProposal path).  
- P2: `AppendBytes32` silent skip on `len>32`.  
- P3: `GetConfirmedTxReceipt` finalizedHeaderCache (per-process).  
- P4: Ithaca pending-stall >1/3 residual under honest fragmentation (documented).

## Live leads

1. Malicious proposer → universal ProcessProposal panic / non-uniform REJECT.  
2. Turn P1 into a concrete halt under mainnet `BorChainTxConfirmations`.  
3. Polygon-introduced CometBFT blocksync serving-budget bypass.  
4. Any Bor consumer still reading a non-normalized clerk string (should be none post-Lugano).
