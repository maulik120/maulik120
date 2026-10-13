# Oisy Wallet — XRP hunt findings

Authorized bounty hunt against [dfinity/oisy-wallet](https://github.com/dfinity/oisy-wallet) (native XRP, v2.6.0–v2.6.2).

- **[FINDINGS.md](./FINDINGS.md)** — HackenProof-style reports (XRP-01 High, XRP-02 Med, XRP-03 Med)
- **[attack-meta.md](./attack-meta.md)** — surfaces, invariants, dead ends
- **[poc/](./poc/)** — runnable PoCs + vitest output

## Reproduce PoCs (against a local Oisy checkout)

```bash
git clone https://github.com/dfinity/oisy-wallet.git
# copy poc/*.oisy.spec.ts into src/frontend/src/tests/xrp/poc/
cd oisy-wallet && npm ci && npx vitest run src/frontend/src/tests/xrp/poc/
```

Last run: `Test Files  2 passed (2) / Tests  7 passed (7)` — see `poc/vitest-output.txt`.
