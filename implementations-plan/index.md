# Implementation plans

- [usdc-bridge](usdc-bridge/plan.md) — arcs 1–3 delivered (phases 1–6 and 8–10 ✓; every codex loop and /harden security converged; 3-PR stack 2026-09-28, merged without testnet per D26); arc 4 (phases 11, 7, 12 ✓) on `usdc-bridge-testnet`: Aztec 6.0.0-rc.1 re-pin, v6 testnet deploy + four-leg smoke, testnet build; PR #5 open, checks green (CI e2e green by dispatch) — USDC-only L1↔Aztec bridge ported from nulo V1 (4df5eae5) with V2-grade QA: guarded portal + Permit2 router + token_bridge/proxy, TS core, React app, local e2e, testnet deploy
