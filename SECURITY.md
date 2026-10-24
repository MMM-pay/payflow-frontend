# Security Policy

## Audit status

Unaudited. Testnet only. Do not connect a wallet holding real value.

##Scope

In scope: transaction construction in `src/lib/payflow.ts`, wallet handling in
`src/lib/wallet.tsx`, amount parsing and formatting in `src/lib/format.ts`, and
anything that could cause a user to sign a transaction other than the one shown
to them.

Out of scope: the Soroban contracts (report in `payflow-contract`), the indexer
(report in `payflow-backend`), and wallet extension bugs.

## Reporting

Do not open a public issue. Use GitHub private vulnerability reporting on this
repository, or email the maintainer in the README. Acknowledgement within
72 hours.

## Design notes

- **This app never holds a private key.** Every state-changing call is built
  locally, handed to the wallet as XDR, and signed by the user. The app cannot
  move funds on its own.
- **The backend is never in the payment path.** It serves reads only. A
  compromised backend can show wrong lists; it cannot cause a payment.
- **All contract addresses come from build-time env vars.** Anyone who can
  change those can point the UI at a malicious contract, so treat deploy
  settings as security-relevant.
- **Amounts are parsed with a strict decimal regex** and converted to `bigint`
  before leaving the browser. Report any input that reaches a contract call as
  a float.
