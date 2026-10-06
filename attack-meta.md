# Attack meta — Heimdall v0.12.1 second pass

Eligible release: tag `v0.12.1` (`6e432e2d`). Develop `ae3de384 → aef9001d` is a kurtosis pin. Not eligible.

Recovery-byte freeze stays killed (see `REPORT.md`). This pass hunted chains that do not depend on it.

## Invariants that held

- A Bor error is not a yes. `SideHandleMsgCheckpoint` returns `VOTE_NO` when `IsValidCheckpoint` errors. `ExtendVote` copies side-sign bytes into the non-RP extension only after `VOTE_YES`. `ProcessProposal` tolerates `ErrFailedToQueryBor` / `ErrBorBlockNotFound` so a down Bor does not reject the whole block. The checkpoint tx can sit in the block. It is not approved and it is not what honest validators sign.
- The account root is bound before anyone signs. `SideHandleMsgCheckpoint` compares `GetAccountRootHash(dividendAccounts)` to `msg.AccountRootHash` and votes no on mismatch. Vote-extension validation does not repeat that check. It does not need to: the signed bytes are taken from a message that already received yes.
- `AppendBytes32` drops a field longer than 32 bytes. Dropping one of the six checkpoint words yields 160 bytes. `UnpackCheckpointSideSignBytes` requires 192. The extension is rejected.
- Honest non-RP bytes are rebuilt from the tx (`GetSideSignBytes`), not taken from another validator's extension. A high-bit uint256 word that `big.Int.Uint64` would truncate cannot become the majority extension unless that validator already has more than two thirds.
- Checkpoint signatures are stored only when the majority extension matches a checkpoint tx in the previous block and that tx was tallied yes (`app/abci.go` PreBlocker).
- `GetConfirmedTxReceipt` treats Ethereum `finalized` as final. The finalized-header cache is cleared in `BeginPrefetchRound` / `EndPrefetchRound`. It does not survive into the next vote and accept an unconfirmed receipt.
- Kyoto sequence keys are injective once `logIndex >= DefaultLogIndexUnit`. Below that, the numeric key does not depend on height. Real receipts cannot reach the alias. Post-handler height is H+1 and does not change the key for real logs.
- Oversized state-sync data is accepted only when `msg.Data` is empty and the event itself is over `MaxStateSyncSize`. The stored payload is empty. It is not attacker calldata.
- Producer ballots cannot repeat a candidate id (`MsgVoteProducers` duplicate map). The positional-weight multiply cannot be aimed at `int64` overflow with stake that fits in POL supply (`power = amount/1e18`).
- `GetPowerFromAmount` divides its argument. Call sites pass `Int.BigInt()`, which returns a copy (`math/int.go`). The message amount is unchanged.
- Milestone propositions with duplicate block hashes are rejected in `ValidateMilestoneProposition` before the vote is accepted. Parent-child voting power is not doubled by repeating a hash.
- `ValidateVoteExtensions` rejects two votes from the same validator before the block can be committed. `tallyVotes` returning an error on that duplicate is a backstop, not a reachable halt.
- `RootChain.submitCheckpoint` stays permissionless. One validator under the two-thirds line is not required for a checkpoint. Omitting their signature still clears L1.

## Dead ends this pass

- Fake Bor root through the Zurich/Phuket tolerate path.
- Account-root substitution inside an otherwise valid checkpoint.
- ABI word truncation as an L1 decode mismatch.
- Finalized-header cache as a confirmation bypass.
- Clerk sequence alias and empty-data substitution.
- Duplicate producer-vote score amplification.
- In-place voting-power division.
- Milestone hash replay for extra voting power.
- Duplicate vote extensions as a PreBlocker halt.
- Span-seed grinding. The seed is a Bor block hash. A producer can bias the next draw. The bias is not a takeover at realistic stake, and there is no local proof of stolen funds.

## Third pass — chains

No chain reached a fake checkpoint root, a second mint, doubled stake, or a committed halt.

### Span-rotation underflow (killed on reachability)

`checkAndRotateCurrentSpan` (`app/abci.go`) does this with `uint64`:

```
endBlock := lastSpan.EndBlock
for endBlock-lastMilestone.EndBlock > 2*params.SpanDuration {
    endBlock -= params.SpanDuration
}
```

If `lastSpan.EndBlock < lastMilestone.EndBlock`, the subtraction wraps and the loop does not return (~2^64 / SpanDuration iterations). The corrective loop under it is never reached. `rotateSpanFromPendingHead` already bails on a head past the span and on a zero duration. This loop does not.

That state is not reachable with an honest majority:

- A committed milestone is a 2/3 proposition of real Bor headers. An honest producer cannot advance past `lastSpan.EndBlock`. One milestone is at most `MaxMilestonePropositionLength` (10) blocks.
- `checkAndAddFutureSpan` runs on every such milestone whose end has reached the span start, and extends by one `SpanDuration` (6400). A failure is swallowed after Kyoto and retried on the next milestone.
- The failure does not stick. `ApplyAndReturnValidatorSetUpdates` runs in the stake `EndBlocker` after the side-tx post-handlers. `GetUpdatedValidators` drops a record with `VotingPower <= 0` (`IsCurrentValidator` requires power > 0). The next block's `filterToCurrentValidators` / `eligibleProducerFallback` select a positive-power validator. Ithaca's zero-power reject is one block, not 6400.
- `SideHandleMsgBackfillSpans` always returns `VOTE_NO`. `SideHandleMsgSpan` returns `VOTE_NO` once `IsRio(startBlock)`. Neither can insert a span whose end sits behind the milestone.
- Pending-stall rotation refuses `pendingHead > lastSpan.EndBlock` before its own runway loop.

A hand-written keeper with span end behind the milestone would hang the function. That is not an attacker transition. Not filed.

### Other chains that do not compose

- Post-handler checkpoint does not re-check the account root. Dividends only increase (`AddFeeToDividendAccount`). A root signed at ExtendVote is a stale, smaller snapshot. It is not an extra L1 claim.
- Ack may overwrite buffer end/root when the end differs. The side handler already required that message to match L1 `GetHeaderInfo` for that checkpoint number. Adopting L1 is the intended rule. The post-handler does not get a second, different root.
- `GetLastCheckpoint` falling through on an error other than `ErrNoCheckpointFound` skips the continuity check. The error is a missing store row, not an attacker input. The buffer id written from a zero checkpoint then collides with `AddCheckpoint` (`ErrAlreadyExists`).
- Signer update writes the old signer at power 0 and the new signer at the original power, keyed by signer (`AddValidator`). `GetAllValidators` returns both. The set update removes the zero-power signer and adds the new one. Power is not doubled.
- Topup mint uses the same `HexCodec` the side handler compared against the event. `MustAccAddressFromHex` does not decode a second address.
- `CalculateHash` nil-panics only if `FeeAmount` is not a base-10 integer. The only writer stores `big.Int.String()`.
- Checkpoint side-sign bytes and the bridge's `SendCheckpoint` payload are the same `GetSideSignBytes()`. A field longer than 32 bytes is dropped and the extension no longer unpacks. Chain id, roots, and block numbers on a valid message all fit.
- Milestone `>= total*2/3+1` and side-tx `> total*2/3` are the same integer threshold. Tally and ProcessProposal use `getValidatorSetForHeight` (penultimate set after the tally-fix height).
- Nested `Any` is already capped (`MaxUnpackAnyRecursionDepth = 10`, plus the Kyoto proposal guard).
- `ValidateVotingPower` divides a `BigInt()` copy. A real stake event cannot exceed `MaxInt64` POL. The `Int64` conversion does not wrap a live amount into extra power.
