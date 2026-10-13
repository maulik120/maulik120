/**
 * PoC XRP-05 — NI send amount is UI `swapAmount`, not signed `quote.amountIn`.
 * See /workspace/FINDINGS.md / attack-meta.md
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const swapServices = readFileSync(resolve(here, '../../../lib/services/swap.services.ts'), 'utf8');

describe('XRP-05 PoC — send amount not rebound to signed amountIn', () => {
	it('executeNearIntentsSwap parses swapAmount and never compares quote.amountIn', () => {
		const start = swapServices.indexOf('const executeNearIntentsSwap = async');
		const end = swapServices.indexOf('export const fetchNearIntentsEvmSwap');
		const body = swapServices.slice(start, end);

		expect(body).toContain('value: `${swapAmount}`');
		expect(body).toContain('amount: parsedSwapAmount');
		expect(body).toContain('depositAddress');
		expect(body).toContain('verifyNearIntentsQuoteSignature(swapDetails)');
		expect(body).not.toMatch(/amountIn/);
		expect(body).not.toMatch(/parsedSwapAmount\s*===\s*BigInt/);
	});
});
