package processor

import (
	"bytes"
	"crypto/ecdsa"
	"testing"

	"github.com/cometbft/cometbft/crypto/secp256k1"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	checkpointtypes "github.com/0xPolygon/heimdall-v2/x/checkpoint/types"
)

// A validator signs the honest checkpoint side-sign bytes. CometBFT
// VerifySignature checks only r||s and ignores the recovery byte, so the
// validator can substitute any V and still pass consensus. The bridge then
// either refuses to build the submission (V outside {0,1,27,28}) or submits a
// signature that ecrecovers to a different address (V flipped within {0,1}).
func TestCraftedRecoveryBytePassesConsensusAndBreaksCheckpointSubmission(t *testing.T) {
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey()
	extension := []byte{0x01, 0x11, 0x22, 0x33, 0x44} // vote byte || checkpoint side-sign payload

	sig, err := priv.Sign(extension)
	require.NoError(t, err)
	require.Len(t, sig, crypto.SignatureLength)
	require.True(t, pub.VerifySignature(extension, sig), "honest signature must verify")

	originalV := sig[crypto.RecoveryIDOffset]
	require.True(t, originalV == 0 || originalV == 1, "comet signer emits recovery id 0 or 1, got %d", originalV)

	// --- Attack A: V outside the bridge's allow-list. Deterministic abort. ---
	poisoned := bytes.Clone(sig)
	poisoned[crypto.RecoveryIDOffset] = 2
	require.True(t, pub.VerifySignature(extension, poisoned),
		"consensus accepts the signature after the recovery byte is replaced")

	honestA := mustSign(t, extension)
	honestB := mustSign(t, extension)
	cp := &CheckpointProcessor{}

	// Two honest validators plus the attacker. One disallowed V fails the
	// entire batch; SendCheckpoint is never reached.
	_, err = cp.parseCheckpointSignatures([]checkpointtypes.CheckpointSignature{
		{ValidatorAddress: []byte{0x01}, Signature: honestA},
		{ValidatorAddress: []byte{0x02}, Signature: poisoned},
		{ValidatorAddress: []byte{0x03}, Signature: honestB},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid signature recovery id 2")

	// --- Attack B: flip 0 <-> 1. Parse succeeds, ecrecover returns someone else. ---
	flipped := bytes.Clone(sig)
	flipped[crypto.RecoveryIDOffset] = originalV ^ 1
	require.True(t, pub.VerifySignature(extension, flipped),
		"flipping the recovery bit still passes consensus verification")

	parsed, err := cp.parseCheckpointSignatures([]checkpointtypes.CheckpointSignature{
		{ValidatorAddress: pub.Address(), Signature: flipped},
	})
	require.NoError(t, err)
	require.Len(t, parsed, 1)
	// Bridge normalizes 0/1 to 27/28 and does not check the recovered signer.
	require.Equal(t, int64(flipped[crypto.RecoveryIDOffset]+27), parsed[0][2].Int64())

	hash := crypto.Keccak256(extension)
	recovered, err := crypto.SigToPub(hash, flipped)
	require.NoError(t, err)
	recoveredAddr := crypto.PubkeyToAddress(*recovered)
	signerAddr := crypto.PubkeyToAddress(*pubToECDSA(t, pub.(secp256k1.PubKey)))
	require.NotEqual(t, signerAddr, recoveredAddr,
		"wrong recovery id recovers a different address, so L1 checkSignatures drops or aborts the sorted signer run")

	honestRecovered, err := crypto.SigToPub(hash, sig)
	require.NoError(t, err)
	require.Equal(t, signerAddr, crypto.PubkeyToAddress(*honestRecovered))
}

func mustSign(t *testing.T, msg []byte) []byte {
	t.Helper()
	sig, err := secp256k1.GenPrivKey().Sign(msg)
	require.NoError(t, err)
	return sig
}

func pubToECDSA(t *testing.T, pub secp256k1.PubKey) *ecdsa.PublicKey {
	t.Helper()
	// comet pubkey is 65-byte uncompressed (0x04 || X || Y), which ecrecover's
	// uncompressed form matches.
	key, err := crypto.UnmarshalPubkey(pub.Bytes())
	require.NoError(t, err)
	return key
}
