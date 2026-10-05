# TRIAGE — DO NOT REPORT

Verdict: kill. The recovery-byte mechanism is real on `v0.12.1`. It is not a bounty finding.

The earlier High write-up ("one validator freezes checkpoint anchoring") does not survive. Consensus accepts the altered byte, the stock bridge parser aborts the batch, and that is where the claim stops. L1 is still reachable, the abort is the Kyoto control, and the `0↔1` flip is not a reliable freeze.

Affected release checked: `v0.12.1` (`6e432e2d`). The develop range `ae3de384 → aef9001d` is a kurtosis pin. It is not in `v0.12.1`. Not eligible, and it is not this issue.

## What was re-checked

CometBFT `v0.3.9-polygon` `VoteExtensionSignBytes` returns the raw `vote.NonRpExtension` as the non-RP message. `Vote.VerifyExtension` calls `PubKey.VerifySignature` on that message. `VerifySignature` requires 65 bytes and then checks `sig[:64]` via `ethCrypto.VerifySignature`. `addVote` rejects the precommit only when that check, or the app `VerifyVoteExtension`, fails.

Heimdall `VerifyVoteExtension` never receives the signature. `checkNonRpVoteExtensionsSignatures` calls the same `VerifySignature(vote.NonRpVoteExtension, vote.NonRpExtensionSignature)`. `getCheckpointSignatures` copies `NonRpExtensionSignature` unchanged when the extension bytes match and the flag is commit (Zurich).

So a validator who signs the honest majority extension and sets `sig[64] = 2` is accepted into the commit and stored. The open question (sign-bytes vs raw extension) does not kill reachability. The two messages are the same bytes.

`parseCheckpointSignatures` then returns on the first `normalizeCheckpointV` error. `v == 2` aborts the whole batch inside the stock processor. That part of the old PoC is true.

## Why the impact claim dies

`RootChain.submitCheckpoint(bytes,uint256[3][])` is `external`. No proposer gate. The bridge's `isCurrentProposer` check is client policy.

`StakeManager.checkSignatures` recovers each signature and counts stake. It `continue`s on `signer == lastAdd` and `break`s on `signer < lastAdd`. `lastAdd` advances only for an active validator. A signature that is not in the array is simply unsigned. Consensus is `signedStake > 2/3`, not "every stored Heimdall signature must be present".

A validator who does not already hold more than one third of stake is not required for that threshold. Withholding their signature does not stop a checkpoint. Their `v = 2` byte stops only the stock parser, which refuses to skip them. Dropping that one entry makes `parseCheckpointSignatures` return the honest signatures. Those `r || s` values still verify. Anyone can pack `submitCheckpoint` with that reduced array.

That is not a freeze of exits. It is a bug in the default bridge loop with a one-signature workaround on a permissionless contract. If the attacker does hold more than one third, omitting them also fails the L1 threshold, and so does withholding the signature. That is the BFT liveness bound, which this program treats as out of scope.

One poisoned checkpoint does not brick later headers by itself. `shouldSendCheckpoint` keys off L1 `lastChildBlock + 1 == start`. A later submission of the same start, with the bad signature removed, advances the header. NoAck only matters for the unmodified processor, which will not send until someone filters or the attacker produces a clean vote.

## Attack B (`0↔1`) does not carry the report

`normalizeCheckpointV` accepts `0/1/27/28`. Flipping `0↔1` still passes `VerifySignature`, and `crypto.SigToPub` recovers a different address. On L1, `ECVerify.ecrecovery(bytes32,uint[3])` adds 27 when `v < 27` and returns `address(0)` when the result is not 27 or 28. A wrong-but-canonical `v` is passed to `ecrecover`.

`checkSignatures` then:

- `break`s only when the recovered address sorts before `lastAdd`
- does not move `lastAdd` when the address is not an active validator
- reverts the whole call only if `ecrecover` returns zero after `v` is already 27 or 28

If the attacker is the lowest signer, `lastAdd` is still zero and a random recovered address does not sort before it. The bad signature is skipped and the rest count. If they are not first, the break is a coin flip on the recovered address. The same omit works. This is not a deterministic freeze and is not a second finding.

## Duplicate / intended control

`normalizeCheckpointV` states the threat in source:

> the consensus-layer signature check ignores the recovery byte, so a crafted vote extension could otherwise carry a byte that recovers to the zero address on L1 and breaks the contract's sorted-signer accounting.

The Kyoto bridge change rejects every byte outside `{0,1,27,28}` for that reason. The public Kyoto note already described a non-canonical recovery byte stalling anchoring. Attack A is that rejection firing. Filing "the batch abort stalls the stock bridge" files the mitigation.

## PoC, narrowed

The unit tests still show three facts and nothing else:

- `VerifySignature` is true for `v = 2` and for `v` flipped inside `{0,1}`
- `getCheckpointSignatures` stores recovery byte 2 with the majority extension
- `parseCheckpointSignatures` errors on that byte, and succeeds on the same honest signatures once the byte is removed

They do not run a network, do not call `submitCheckpoint`, and do not show frozen exits.

```
go test -count=1 -timeout 180s \
  -run 'TestCraftedRecoveryBytePassesConsensusAndBreaksCheckpointSubmission|TestPoisonedRecoveryByteIsPersistedWithTheMajorityExtension' \
  ./bridge/processor/ ./app/
```

## Severity

Not High. Not Medium. No reportable impact under the program's temporary-freeze category. Do not send.
