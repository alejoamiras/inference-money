# Implementation plans

- [usdc-bridge](usdc-bridge/plan.md) — implementing (phases 1–6 ✓, arcs 1–2 loops converged; phase 7 blocked on testnet USDC; phases 8–10 code complete, ✓ waits on phase 7 (the testnet build); arcs 1–3, the final cross-arc loop and /harden security (1 Medium, fixed, re-reviewed) converged; phase 7 + delivery wait on 5 testnet USDC) — USDC-only L1↔Aztec bridge ported from a prior V1 bridge with V2-grade QA: guarded portal + Permit2 router + token_bridge/proxy, TS core, React app, local e2e, testnet deploy
