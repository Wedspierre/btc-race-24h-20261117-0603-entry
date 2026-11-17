// Range-low dip bot for the make.fun 24h BTC race (agent-fun/bars-replay/v1).
//
// Long-only cbBTC/USDC, one position at a time, full cash on entry. The dev
// window is a choppy, nearly flat 24 hours (+0.49% close to close, 1-minute
// returns with a 6.4 bps standard deviation) where a full-size round trip
// costs ~37 bps in fee + slippage + pool impact, so every fast trend or
// mean-reversion rule backtested offline lost money: EMA crosses (8/21:
// -$106), RSI/Bollinger (-$53), Donchian breakouts (-$4 to -$70), dip-buys
// with fixed targets (-$3 to -$107). The only shape that cleared costs with
// a margin buys near the bottom of a long range and lets the winner run:
//
//   ENTRY (flat only), on a bar's close:
//     - at least 480 bars of history, and the close is within 0.20% of the
//       lowest close of the last 480 minutes (an 8-hour low),
//     - the close is no more than 0.80% below the 240-minute EMA (a
//       downtrend filter: in a falling market the 480-minute low keeps
//       falling, so buying it is catching a knife; this filter cut a
//       mirrored/downtrend stress test from -$31 to -$16 while leaving the
//       dev result untouched),
//     - the close ticked up from the previous bar (one-bar bounce
//       confirmation, so we do not buy a still-falling tick).
//   EXIT (holding), on a bar's close, whole position:
//     - the close reaches 99.9% of the highest close of the last 480
//       minutes (range top), or
//     - a 0.40% trailing stop from the highest close since entry, or
//     - a 1.00% hard stop below the entry close.
//
// On the published dev window this fires 6 orders (3 round trips) and nets
// about +$13 after every fee, with max drawdown under 1%. The big winner is
// the hour-8 spike: bought near the day low, sold into the 8-hour high.
// Sensitivity around the chosen parameters is a plateau, not a spike:
// near 0.20% / trailing 0.30-0.50% / floor 0.70-1.00% all clear +$11 to
// +$15 on the dev window, so the edge is the shape, not a tuned constant.
//
// All arithmetic is exact integers on raw price units (BigInt; the EMA is
// kept in fixed point, scaled by 10**6). No floats in decisions, no clock,
// no network, no files, no randomness: the same bars give byte-identical
// orders on every run.

import { BPS, runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Lookback for the range (minutes) and for the trend filter EMA.
const RANGE_BARS = 480;
const EMA_BARS = 240;
// Entry: close within this of the RANGE_BARS low, and no further than
// this below the EMA. In basis points.
const NEAR_LOW_BPS = 20n;
const EMA_FLOOR_BPS = 80n;
// Exits, in basis points: trailing stop from the peak since entry, hard
// stop below the entry close, and the range-top target (99.9% of the
// RANGE_BARS high).
const TRAIL_BPS = 40n;
const HARD_STOP_BPS = 100n;
const TOP_BPS = 9990n; // 99.90%
// Orders cap their slippage at 200 bps from the latest close; a 1-minute
// move that large essentially never happens on this pool, so fills are
// (like the offline backtest) effectively never rejected for slippage,
// while a true liquidity gap still cannot fill us for almost nothing.
const MAX_SLIPPAGE_BPS = 200;

const EMA_SCALE = 1_000_000n;

const closes: bigint[] = []; // raw close prices, oldest first
let prevClose: bigint | null = null; // previous bar's close, for the uptick
let ema: bigint | null = null; // EMA(EMA_BARS), fixed point x EMA_SCALE
let warm: bigint[] = []; // closes collected while the EMA seeds
let entryClose: bigint | null = null; // close we bought at (raw units)
let peak: bigint | null = null; // highest close since entry (raw units)

function push(close: bigint): void {
  closes.push(close);
  if (ema === null) {
    warm.push(close);
    if (warm.length === EMA_BARS) {
      ema = (warm.reduce((a, x) => a + x, 0n) * EMA_SCALE) / BigInt(EMA_BARS);
      warm = [];
    }
  } else {
    // EMA += 2/(span+1) * (close - EMA), in fixed point.
    ema += (2n * (close * EMA_SCALE - ema)) / BigInt(EMA_BARS + 1);
  }
}

function rangeLow(closes: readonly bigint[]): bigint {
  let lo = closes[0];
  for (const c of closes) if (c < lo) lo = c;
  return lo;
}

function rangeHigh(closes: readonly bigint[]): bigint {
  let hi = closes[0];
  for (const c of closes) if (c > hi) hi = c;
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const fresh = batch.bars.filter((b) => b.symbol === SYMBOL);
    if (fresh.length === 0 || state.warmingUp) return [];
    // A bar with a missing, non-numeric or non-positive close must never
    // crash the run: BigInt() throws on those, so skip the bar instead.
    let close: bigint;
    try {
      close = BigInt(fresh[0].c);
    } catch {
      return [];
    }
    if (close <= 0n) return [];
    const uptick = prevClose !== null && close > prevClose;
    push(close);
    prevClose = close;

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (entryClose === null) {
        // Position held from before this run's memory (cannot happen:
        // we only ever buy through this code); treat the current close
        // as the entry.
        entryClose = close;
        peak = close;
      }
      if (close > peak!) peak = close;
      const sell = (): OrderInput[] => {
        entryClose = null;
        peak = null;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      };
      if (closes.length >= RANGE_BARS) {
        const hi = rangeHigh(closes.slice(-RANGE_BARS));
        if (close * BPS >= hi * TOP_BPS) return sell();
      }
      if (close * BPS < peak! * (BPS - TRAIL_BPS)) return sell();
      if (close * BPS <= entryClose! * (BPS - HARD_STOP_BPS)) return sell();
      return [];
    }

    // Flat: look for the range-low entry.
    if (closes.length < RANGE_BARS || ema === null || !uptick) return [];
    const lo = rangeLow(closes.slice(-RANGE_BARS));
    if (close > (lo * (BPS + NEAR_LOW_BPS)) / BPS) return [];
    // close >= EMA * (1 - EMA_FLOOR_BPS): the downtrend filter. Compare in
    // fixed point so the EMA is not truncated to whole raw units first;
    // truncating it would move the filter line by up to one raw unit.
    if (close * BPS * EMA_SCALE < ema * (BPS - EMA_FLOOR_BPS)) return [];
    const room = state.weightRoom(SYMBOL);
    const amount = state.cash < room ? state.cash : room;
    if (amount < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    peak = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
