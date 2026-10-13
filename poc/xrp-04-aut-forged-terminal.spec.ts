/**
 * PoC XRP-04 — Plain XRP AUT leave-Pending / false-expiry unlock (frontend half).
 *
 * Backend half: `cargo test -p backend --lib poc_xrp04_ -- --nocapture`
 * (tests injected under oisy-wallet/.../model.rs; see FINDINGS.md).
 *
 * Chain:
 * 1. Honest send creates Pending AUT with real last_ledger_sequence + tx_hash.
 * 2. Same-principal update rewrites last_ledger_sequence → "1" (backend allows).
 * 3. Poller searches the wrong window, sees absence past validated index, writes Failed.
 * 4. Plain Xrp Failed update carries NO ledger_result (unlike NearIntents).
 * 5. holds_xrp_address clears → second send create is accepted while payment #1
 *    can still validate on XRPL → classic false-failure double-send.
 */
import type { ActiveUserTransaction } from '$declarations/backend/backend.did';
import * as activeUserTransactionsServices from '$lib/services/active-user-transactions.services';
import {
	mockXrpActiveUserTransaction,
	mockXrpLastLedgerSequence,
	mockXrpTxHash
} from '$tests/mocks/active-user-transactions.mock';
import { mockIdentity } from '$tests/mocks/identity.mock';
import { XRP_LEDGER_SEARCH_LOOKBACK } from '$xrp/constants/xrp.constants';
import * as xrplRest from '$xrp/rest/xrpl.rest';
import { pollXrpActiveUserTransactions } from '$xrp/services/xrp-active-tx.services';
import { XrpNetworks } from '$xrp/types/network';
import { XRP_EXTERNAL_REF_KEYS } from '$xrp/types/xrp-active-tx';
import {
	toXrpExternalRefsMap,
	xrpActiveUserTransactionPollKeys
} from '$xrp/utils/xrp-active-tx.utils';
import { describe, expect, it, vi } from 'vitest';

describe('XRP-04 PoC — forged early LLS → poller false-expires plain send', () => {
	it('poll keys follow attacker-rewritten last_ledger_sequence on the row', () => {
		const tampered: ActiveUserTransaction = {
			...mockXrpActiveUserTransaction,
			external_refs: mockXrpActiveUserTransaction.external_refs.map((ref) =>
				ref.key === XRP_EXTERNAL_REF_KEYS.LAST_LEDGER_SEQUENCE
					? { key: ref.key, value: '1' }
					: ref
			)
		};

		const keys = xrpActiveUserTransactionPollKeys(tampered);

		expect(keys).toEqual({ hash: mockXrpTxHash, lastLedgerSequence: 1 });
		expect(toXrpExternalRefsMap(tampered.external_refs).last_ledger_sequence).toBe('1');
		// Honest blob still carries mockXrpLastLedgerSequence (≃ 1020); row says 1.
		expect(mockXrpLastLedgerSequence).toBeGreaterThan(1);
	});

	it('poller marks Failed/expired when LLS was rewritten early and hash is absent in that window', async () => {
		const tampered: ActiveUserTransaction = {
			...mockXrpActiveUserTransaction,
			external_refs: mockXrpActiveUserTransaction.external_refs.map((ref) =>
				ref.key === XRP_EXTERNAL_REF_KEYS.LAST_LEDGER_SEQUENCE
					? { key: ref.key, value: '1' }
					: ref
			)
		};

		const applySpy = vi
			.spyOn(activeUserTransactionsServices, 'applyActiveUserTransactionPollUpdate')
			.mockResolvedValue();

		vi.spyOn(xrplRest, 'loadXrpTransactionOutcome').mockResolvedValue({ state: 'absent' });
		// Validated tip is far past the forged LLS=1 (and past the real LLS too).
		vi.spyOn(xrplRest, 'loadXrpValidatedLedgerIndex').mockResolvedValue(
			mockXrpLastLedgerSequence + 50
		);

		await pollXrpActiveUserTransactions({
			identity: mockIdentity,
			transactions: [tampered]
		});

		// Wrong window: firstLedgerSequence = max(1 - lookback, 0) = 0, last = 1.
		expect(xrplRest.loadXrpTransactionOutcome).toHaveBeenCalledWith({
			hash: mockXrpTxHash,
			network: XrpNetworks.mainnet,
			firstLedgerSequence: Math.max(1 - XRP_LEDGER_SEARCH_LOOKBACK, 0),
			lastLedgerSequence: 1
		});

		expect(applySpy).toHaveBeenCalledWith({
			identity: mockIdentity,
			tx: tampered,
			update: expect.objectContaining({
				status: { Failed: null },
				error: expect.any(String)
			})
		});

		// Plain send path does NOT attach ledger_result refs — backend still accepts Failed.
		const update = applySpy.mock.calls[0]?.[0]?.update as Record<string, unknown>;
		expect(update).not.toHaveProperty('externalRefs');
	});
});
