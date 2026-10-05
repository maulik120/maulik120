# FINDING — One validator freezes Polygon checkpoint anchoring by flipping an unauthenticated recovery byte

Severity: High
Impact: Checkpoint signatures are persisted, then every bridge processor aborts L1 `submitCheckpoint`. Exits that depend on a new header block stay frozen for as long as the validator keeps voting. Heimdall consensus itself continues.
Likelihood: Medium. Requires one live validator key of any stake. Not permissionless, so not Critical under Polygon's current table (High impact × Medium probability = High).
Affected release: `v0.12.1` (latest published release; Lugano already active on mainnet at height 54,627,000). The bug is not gated on Lugano. It is live wherever Zurich commit-only checkpoint signatures are live (mainnet Kyoto height 51,533,000, already passed).
Affected commit: `6e432e2d1c412a732721fb9e0c7fd2fafb663d64` (`v0.12.1`)
Affected component: non-RP checkpoint vote extensions (`app/vote_ext_utils.go`, `app/abci.go`) and bridge submission (`bridge/processor/checkpoint.go`), on top of Polygon CometBFT `v0.3.9-polygon` `secp256k1.PubKey.VerifySignature`.

The supplied develop range `ae3de384 → aef9001d` is a kurtosis pin bump in two workflow files. It is not in `v0.12.1` and is not bounty-eligible. The bug below is in the eligible release.

## Summary

Checkpoint votes are secp256k1 signatures of the form `r || s || v`. Polygon's CometBFT fork verifies only `r || s` and ignores `v`. Heimdall stores every commit vote whose extension bytes match the majority checkpoint, including a validator-chosen `v`. The bridge then either rejects the entire signature batch (`v` not in `{0,1,27,28}`) or submits a signature that recovers to a different address (`v` flipped inside `{0,1}`). One validator can do this on every checkpoint without losing their consensus vote.

## Root Cause

`PubKey.VerifySignature` in `github.com/0xPolygon/cometbft v0.3.9-polygon` (`crypto/secp256k1/secp256k1.go`) requires a 65-byte signature and then verifies `sig[:64]` only.

`checkNonRpVoteExtensionsSignatures` uses that function and never reads the recovery byte. `getCheckpointSignatures` copies `NonRpExtensionSignature` into state when the extension bytes match. `parseCheckpointSignatures` is the first place `v` is inspected, and a single bad byte returns an error for the whole batch. Nothing drops just that signer.

## Exact Code Path

1. Validator signs the honest majority non-RP extension (the checkpoint side-sign bytes) and sets `sig[64] = 2`, or flips a honest `0/1` to the other value.
2. `ProcessProposal` → `ValidateNonRpVoteExtensions` → `checkNonRpVoteExtensionsSignatures`. Verification succeeds. The proposal is not rejected.
3. `PreBlocker` → `getCheckpointSignatures` persists that signature next to the honest ones (`app/abci.go` around the `SetCheckpointSignatures` call).
4. Bridge `createAndSendCheckpointToRootChain` → `parseCheckpointSignatures`.
   - `v == 2`: `normalizeCheckpointV` returns an error and `SendCheckpoint` is never called.
   - `v` flipped `0 ↔ 1`: the batch is submitted. L1 `StakeManager.checkSignatures` recovers a different address. If that address sorts before the previous signer, the loop `break`s and drops every later signature, so `submitCheckpoint` gets reward `0` and reverts with `Invalid checkpoint`.

## Attacker Model

Byzantine validator. Any voting power. Must be in the commit (they vote for the honest block; only `v` is wrong). Not admin, not governance, not 51%.

## Security Property Violated

A checkpoint signature that consensus accepts must be submittable to L1 as that validator's signature, or it must be excluded before it is persisted. Today it is accepted, persisted, and then it poisons the whole batch.

## Attack Sequence

1. Honest proposers build a normal `MsgCheckpoint`. Validators agree on the same side-sign bytes.
2. The attacker signs those exact bytes and replaces the recovery byte.
3. The block commits. Heimdall stores the signature set.
4. Every bridge processor running `v0.12.1` fails `parseCheckpointSignatures` (attack A) or L1 reverts (attack B).
5. After the checkpoint buffer expires, NoAck rotates the proposer. The next checkpoint is poisoned the same way.

## Dynamic PoC

Tests were added on a checkout of tag `v0.12.1` and run with Go 1.26.5. They call the real `VerifySignature`, the real `parseCheckpointSignatures`, and the real `getCheckpointSignatures`. No database edits, no stubbed signature checks.

```
go test -count=1 -timeout 180s \
  -run 'TestCraftedRecoveryBytePassesConsensusAndBreaksCheckpointSubmission|TestPoisonedRecoveryByteIsPersistedWithTheMajorityExtension' \
  ./bridge/processor/ ./app/
```

Result:

```
ok  github.com/0xPolygon/heimdall-v2/bridge/processor
ok  github.com/0xPolygon/heimdall-v2/app
```

Attack A asserted: `VerifySignature` is true for `v = 2`, and `parseCheckpointSignatures` on a batch of two honest signatures plus that one returns `invalid signature recovery id 2`.

Attack B asserted: flipping `v` still verifies, the bridge normalizes it to 27 or 28, and `crypto.SigToPub` recovers an address different from the signer. The honest `v` recovers the signer.

Persistence asserted: `getCheckpointSignatures` at a post-Zurich height stores the signature whose recovery byte is 2.

Copies of the tests are in `poc/heimdall-v2/`. Drop them onto a `v0.12.1` tree and run the command above.

## Why Existing Defenses Fail

The Kyoto bridge change canonicalizes honest `0/1` and `27/28` and rejects every other byte. That rejection is fail-closed for the whole batch, which is the freeze. Consensus never sees `v`, so the bad vote is not dropped in `VerifyVoteExtension` or `ProcessProposal`. `checkSignatures` on L1 does not skip an out-of-order recovered address; it stops the scan.

## Impact

New L1 header blocks stop. Polygon exits that need a checkpoint root newer than the last successful header block cannot complete. Heimdall block production is unaffected. The freeze lasts until the validator stops or is removed. There is no slashing path for this vote, because the consensus signature check passes.

## Severity Justification

Polygon's table: High impact + Medium probability = High. This is temporary freezing of bridge funds, not theft and not a consensus split. It is not Critical because it is not permissionless.

## Remediation

Authenticate `v` before the vote is accepted. In `checkNonRpVoteExtensionsSignatures`, recover the public key with the full 65-byte signature and require it to match the validator key; reject the vote otherwise. In `parseCheckpointSignatures`, skip a signature that fails `normalizeCheckpointV` or fails signer recovery, and submit the rest when the remaining stake is still above the L1 threshold. Do not fail the entire batch on one byte.

## Duplicate / Variant Analysis

Public Kyoto write-up (forum, Heimdall v0.11.0): a non-canonical recovery byte could fail L1 recovery and stall anchoring. That fix handles honest `0/1` versus `27/28` at the bridge. It does not bind `v` in consensus. A validator-chosen `v` outside that set, or the wrong member of `{0,1}`, still stalls submission. Same root cause, different remaining path. The develop-only CI diff is unrelated.

## REPORT
