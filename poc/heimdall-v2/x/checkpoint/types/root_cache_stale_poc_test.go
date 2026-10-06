package types_test

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	helpermocks "github.com/0xPolygon/heimdall-v2/helper/mocks"
	checkpointTypes "github.com/0xPolygon/heimdall-v2/x/checkpoint/types"
)

// TestIsValidCheckpoint_RootCacheServesStaleRootWithoutRequery proves the
// package-level rootCache (10s wall TTL) returns the first Bor answer for a
// (start,end,checkpointLength) key even if a later GetRootHash would differ.
//
// Impact bar: not a permissionless High by itself. Becomes an ACCEPT/REJECT
// split only if honest validators' Bor endpoints disagree inside the TTL.
func TestIsValidCheckpoint_RootCacheServesStaleRootWithoutRequery(t *testing.T) {
	start, end, length, conf := uint64(9_100_000), uint64(9_100_255), uint64(256), uint64(16)
	rootA := bytes32(0xaa)
	rootB := bytes32(0xbb)

	var getRootCalls atomic.Int64
	caller := new(helpermocks.IContractCaller)
	caller.On("CheckIfBlocksExist", mock.Anything, end+conf).Return(true, nil)
	caller.On("GetRootHash", mock.Anything, start, end, length).
		Run(func(args mock.Arguments) { getRootCalls.Add(1) }).
		Return(append([]byte(nil), rootA...), nil).Once()
	// If cache is bypassed, a second call would return rootB.
	caller.On("GetRootHash", mock.Anything, start, end, length).
		Run(func(args mock.Arguments) { getRootCalls.Add(1) }).
		Return(append([]byte(nil), rootB...), nil).Maybe()

	ok, err := checkpointTypes.IsValidCheckpoint(context.Background(), start, end, rootA, length, caller, conf)
	require.NoError(t, err)
	require.True(t, ok)
	require.EqualValues(t, 1, getRootCalls.Load())

	ok, err = checkpointTypes.IsValidCheckpoint(context.Background(), start, end, rootA, length, caller, conf)
	require.NoError(t, err)
	require.True(t, ok, "stale cached rootA still validates")
	require.EqualValues(t, 1, getRootCalls.Load(), "GetRootHash must not be called again within TTL")

	ok, err = checkpointTypes.IsValidCheckpoint(context.Background(), start, end, rootB, length, caller, conf)
	require.NoError(t, err)
	require.False(t, ok, "rootB rejected because cache still holds rootA")
	require.EqualValues(t, 1, getRootCalls.Load(), "still no requery — cache short-circuits")
}

func bytes32(b byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return out
}
