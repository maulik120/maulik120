# Heimdall-v2 aggressive hunt status (v0.12.1)

**Program:** Polygon Immunefi · `0xPolygon/heimdall-v2` latest published release  
**Tag:** `v0.12.1` (`6e432e2d`) · Lugano live (mainnet `54,627,000`)  
**Verdict this session:** no permissionless High/Critical with runnable impact PoC.

Prior claim (recovery-byte freeze) remains **killed** — see branch `cursor/heimdall-checkpoint-recovery-b7a6`.

## Money-first ranking applied

1. Keys/ops / single verifier — L1 `submitCheckpoint` is permissionless; ack requires majority side-tx + matching RootChain header.  
2. UI≠payload — N/A on this asset.  
3. Forged L1-bound message (clerk/stake/topup/checkpoint) — main hunt surface.  
4. Code/halt (ProcessProposal / VE / cache) — secondary.

## Paths attacked this session (all killed or below bar)

| Path | Result | Invariant |
| --- | --- | --- |
| Clerk homoglyph contract address (Bor decode split) | **Killed** | Lugano `normalizeContractAddress` + `BlockHeight()-1` post-handler gate |
| Topup `msg.User` homoglyph → wrong credit | **Killed** | Side gate uses `HexCodec.StringToBytes`; credit uses `MustAccAddressFromHex` on same decode family; `sdkmath.Int.BigInt()` returns a **copy** so `GetPowerFromAmount` mutation cannot desync amount checks |
| Fake / weak `MsgCpAck` | **Killed** | Side handler requires L1 `GetHeaderInfo` match; buffer adjust only when L1 already holds a majority-signed header |
| Tx-hash padding collisions (clerk) | **Killed** | Lugano `IsValidTxHash` = exact `0x` + 64 hex; short forms only pass pre-Lugano `IsTxHashNonEmpty` |
| Dividend account case-key split | **Killed** | `FormatAddress` on set/get/add |
| `GetPowerFromAmount` in-place `Div` | **Killed** (reconfirmed) | Mutates only the `*big.Int` copy from `BigInt()`, not the `sdkmath.Int` |
| Milestone duplicate-hash / parent inflate | **Killed** (prior + Zurich parent bind) | `ValidateMilestoneProposition` rejects dup hashes; Zurich binds parent to last milestone end |
| Recovery-byte freeze | **Killed** (prior) | Kyoto fail-closed + permissionless omit |

## Primitives noted (not findings alone)

- `IsValidCheckpoint` process-local 10s TTL cache (`x/checkpoint/types/merkle.go`) on a path also reached from `ProcessProposal` / `VerifyVoteExtension`. Safe while Bor roots are stable; under divergent RPC answers validators can disagree. Needs a halt PoC under realistic confirmations — not filed.  
- `AppendBytes32` silently skips fields `>32` bytes (`types/dividend_account.go`). Checkpoint `RootHash`/`AccountRootHash` length-gated elsewhere; residual defense-in-depth only.  
- Ithaca pending-stall: documented `>1/3` residual under honest vote fragmentation — accepted trust model, not a new bypass.  
- `GetConfirmedTxReceipt` prefers finalized API; `receipt.Status` not checked (standard EVM: failed txs emit no logs).

## Next hunt order

1. Malicious-proposer → universal `ProcessProposal` panic/REJECT split (1-of-N validator = High Probability for halt under team rules).  
2. Cache/RPC divergence PoC that actually forks ACCEPT vs REJECT on mainnet confirmation params.  
3. Clerk/Bor consumer path: any residual string that Bor still decodes differently **after** Lugano normalize (event attribute vs stored record already aligned in tests).  
4. CometBFT `v0.3.9-polygon` blocksync serving budget edge cases (Polygon-introduced only).

## Repro environment

```bash
git clone https://github.com/0xPolygon/heimdall-v2.git && cd heimdall-v2
git checkout v0.12.1   # 6e432e2d
# Go 1.26.5
go test -count=1 ./x/clerk/keeper/ -run ContractAddressNormalized
go test -count=1 ./x/checkpoint/keeper/ ./app/ -count=1
```

Dossier: `attack-meta.md`.
