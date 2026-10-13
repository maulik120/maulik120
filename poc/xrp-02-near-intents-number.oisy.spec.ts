/**
 * PoC XRP-02 — NEAR Intents receive amount via Number() loses precision.
 * See /workspace/FINDINGS.md
 */
import type { NearIntentsQuoteResponse } from '$lib/types/near-intents';
import { mapNearIntentsQuoteResult } from '$lib/utils/swap.utils';
import { mockNearIntentsQuoteResponse } from '$tests/mocks/near-intents.mock';

const quoteWithAmountOut = (amountOut: string, minAmountOut?: string): NearIntentsQuoteResponse => ({
	...mockNearIntentsQuoteResponse,
	quote: {
		...mockNearIntentsQuoteResponse.quote,
		amountOut,
		amountOutFormatted: amountOut,
		...(minAmountOut !== undefined ? { minAmountOut } : {})
	}
});

describe('PoC XRP-02: NEAR Intents Number() precision on receiveAmount', () => {
	it('loses 1 wei on a 1e18+1 amountOut (ETH base units after XRP→ETH)', () => {
		const amountOut = '1000000000000000001';
		const result = mapNearIntentsQuoteResult(quoteWithAmountOut(amountOut));

		expect(result.receiveAmount).not.toBe(BigInt(amountOut));
		expect(result.receiveAmount).toBe(1000000000000000000n);
		expect(BigInt(amountOut) - result.receiveAmount).toBe(1n);
	});

	it('mangles minAmountOut the same way (slippage floor lies)', () => {
		const minAmountOut = '9007199254740993';
		const result = mapNearIntentsQuoteResult(
			quoteWithAmountOut('9007199254740993', minAmountOut)
		);

		expect(result.receiveOutMinimum).not.toBe(BigInt(minAmountOut));
		expect(result.receiveOutMinimum).toBe(9007199254740992n);
	});

	it('safe path: small XRP-sized amountOut is exact (control)', () => {
		const amountOut = '25000000';
		const result = mapNearIntentsQuoteResult(quoteWithAmountOut(amountOut));

		expect(result.receiveAmount).toBe(25000000n);
	});
});
