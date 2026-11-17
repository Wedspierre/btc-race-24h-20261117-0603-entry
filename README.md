# btc-race-24h-20261117-0603-entry

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Wedspierre/btc-race-24h-20261117-0603-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Wedspierre/btc-race-24h-20261117-0603-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A range-low dip bot for cbBTC on the agent-fun/bars-replay/v1 harness (Node 22, stdlib only). It trades one very selective shape: a close within 0.20% of its 480-minute low, no more than 0.80% below its 240-minute EMA, ticking up from the previous bar — then exits at 99.9% of the 480-minute high, on a 0.40% trailing stop, or on a 1.00% hard stop. Long only, one position, full cash on entry, flat the rest of the time. On the published dev window it makes 6 trades (3 round trips) and nets +$12.79 after every fee, with max drawdown 0.82%.

## Why this shape

The dev window is a choppy, nearly flat 24 hours (+0.49% close to close, 1-minute returns with a 6.4 bps standard deviation) where a full-size round trip costs ~37 bps in fee + slippage + pool impact. Every fast rule backtested offline lost money after costs: EMA crosses (8/21: −$106), RSI/Bollinger (−$53), Donchian breakouts (−$4 to −$70), dip-buys with fixed targets (−$3 to −$107). The only shape that cleared costs with a margin buys near the bottom of a long (8-hour) range and lets the winner run to the range top. The big winner is the hour-8 spike: bought near the day low, sold into the 8-hour high.

The 240-minute EMA floor is a downtrend filter: in a falling market the 480-minute low keeps falling, so buying it is catching a knife. It cut a mirrored/downtrend stress test from −$31 to −$16 while leaving the dev result untouched. Sensitivity around the chosen parameters is a plateau, not a spike: near 0.20% / trailing 0.30–0.50% / floor 0.70–1.00% all clear +$11 to +$15 on the dev window, so the edge is the shape, not a tuned constant. Net PnL at 2x fees is still +$10.37.

## Run it

`main.ts` in the repo root speaks `agent-fun/bars-replay/v1` through the vendored kit SDK shim (`vendor/makefun-bars.ts`, byte-identical copy of the kit's `sdk/makefun-bars.ts`). All arithmetic is exact integers on raw price units (BigInt; the EMA is kept in fixed point, scaled by 10⁶). No floats in decisions, no clock, no network, no files, no randomness — two runs on the same bars give byte-identical orders.

```sh
node cli/makefun.mjs grade-local --kit . --bot ~/workspace/makefun/btc-race-24h-20261117-0603-repo --driver process
```

## Local grade (dev window)

From inside the unpacked kit directory:

```text
net PnL   12.788139 USDC  (return 0.012788139)
trading   6 trades over 1 symbols, win rate 0.666666666, max drawdown 0.008192181,
          exposure 0.204166666, sharpe 0.027089273, 0 rejected
fees      2.424370 USDC; at 2x fees net PnL 10.366751 USDC
guardrails met (trades ok, symbols ok, drawdown ok)
L1 regrade reproduced byte for byte
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ta01qs0h&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
