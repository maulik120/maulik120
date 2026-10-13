/**
 * PoC XRP-01 — Send QR path drops XRPL destination tags.
 * See /workspace/FINDINGS.md
 */
import { decodeQrCode, decodeQrCodeUrn } from '$lib/utils/qr-code.utils';
import { invalidXrpAddress } from '$xrp/utils/xrp-address.utils';
import { decodePayment } from '@icp-sdk/canisters/ledger/icrc';

vi.mock(import('@icp-sdk/canisters/ledger/icrc'), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		decodePayment: vi.fn()
	};
});

const CLASSIC = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';
const TAG = 12345;

describe('PoC XRP-01: send QR drops destination tags', () => {
	beforeEach(() => {
		vi.mocked(decodePayment).mockReturnValue(undefined);
	});

	it('decodeQrCode treats xrpl:…?dt= as a single destination string (no tag field)', () => {
		const urn = `xrpl:${CLASSIC}?dt=${TAG}&amount=10`;
		const result = decodeQrCode({ status: 'success', code: urn });

		expect(result.status).toBe('success');
		expect(result.destination).toBe(urn);
		expect((result as { destinationTag?: number }).destinationTag).toBeUndefined();
		expect(invalidXrpAddress(result.destination)).toBeTruthy();
	});

	it('decodeQrCode treats classic?dt= the same way', () => {
		const code = `${CLASSIC}?dt=${TAG}`;
		const result = decodeQrCode({ status: 'success', code });

		expect(result.destination).toBe(code);
		expect(invalidXrpAddress(result.destination)).toBeTruthy();
	});

	it('URN helper CAN extract address + dt — send path simply never uses it', () => {
		const urn = `xrpl:${CLASSIC}?dt=${TAG}&amount=10`;
		const decoded = decodeQrCodeUrn({ urn });

		expect(decoded?.destination).toBe(CLASSIC);
		expect(decoded?.dt).toBe(TAG);
		expect(invalidXrpAddress(decoded?.destination)).toBeFalsy();
	});

	it('plain classic address works — only tag-bearing forms break', () => {
		const result = decodeQrCode({ status: 'success', code: CLASSIC });

		expect(result.destination).toBe(CLASSIC);
		expect(invalidXrpAddress(result.destination)).toBeFalsy();
	});
});
