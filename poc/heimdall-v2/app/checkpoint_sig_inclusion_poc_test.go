package app

import (
	"bytes"
	"testing"

	abciTypes "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/secp256k1"
	cmtTypes "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/require"

	"github.com/0xPolygon/heimdall-v2/helper"
)

// getCheckpointSignatures copies every commit vote whose non-RP extension
// matches the majority bytes. The recovery byte is stored as received. This
// does not show that the checkpoint cannot be submitted without that vote.
func TestPoisonedRecoveryByteIsPersistedWithTheMajorityExtension(t *testing.T) {
	orig := helper.GetZurichHardforkHeight()
	helper.SetZurichHardforkHeight(1)
	t.Cleanup(func() { helper.SetZurichHardforkHeight(orig) })

	priv := secp256k1.GenPrivKey()
	extension := bytes.Repeat([]byte{0xab}, 64)
	sig, err := priv.Sign(extension)
	require.NoError(t, err)
	sig[crypto.RecoveryIDOffset] = 2
	require.True(t, priv.PubKey().VerifySignature(extension, sig))

	stored := getCheckpointSignatures(10, extension, []abciTypes.ExtendedVoteInfo{
		{
			BlockIdFlag:             cmtTypes.BlockIDFlagCommit,
			Validator:               abciTypes.Validator{Address: priv.PubKey().Address()},
			NonRpVoteExtension:      extension,
			NonRpExtensionSignature: sig,
		},
	})

	require.Len(t, stored.Signatures, 1)
	require.Equal(t, byte(2), stored.Signatures[0].Signature[crypto.RecoveryIDOffset])
	require.Equal(t, priv.PubKey().Address().Bytes(), stored.Signatures[0].ValidatorAddress)
}
