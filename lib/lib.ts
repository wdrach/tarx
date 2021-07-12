import { Observable, Subject, Subscription, combineLatest, zip, Subscriber } from 'rxjs';
import { bufferCount, filter, map, pluck, scan, skipWhile, takeUntil, withLatestFrom } from 'rxjs/operators';
import WS from 'ws';
import axios from 'axios';
import crypto from 'crypto';
import chalk from 'chalk';
import { promises } from 'fs';

import dotenv from 'dotenv';
import { CoinbaseGranularity, CoinbaseProduct, COINBASE_API, COINBASE_EARLIEST_TIMESTAMP, COINBASE_TRANSACTION_FEE, LogLevel } from './constants';
dotenv.config();


export interface AlgorithmResult {
  entry?: Observable<boolean>;
  exit?: Observable<boolean>;
  entryTarget?: Observable<number>;
  exitTarget?: Observable<number>;
  entryStop?: Observable<number>;
  exitStop?: Observable<number>;
  rank?: Observable<number>;

  // eslint-disable-next-line
  state?: Record<string, Observable<any>>;
}

export interface IntermediateAlgorithmResult {
  entry?: boolean;
  exit?: boolean;

  entryTarget?: number;
  exitTarget?:  number;
  entryStop?:   number;
  exitStop?:    number;

  rank?: number;

  // eslint-disable-next-line
  state?: Record<string, Observable<any>>;
}

export interface ExtendedAlgorithmResult extends IntermediateAlgorithmResult {
    close?: number;
}

/** A convenience class for working with candle data */
export class Candle {
  /** The time (in seconds since epoch) extracted from the candle object */
  time: number;

  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;

  /**
   * Turn a tlhocv array (from the Coinbase Pro API, for example) into an object-like candle
   * 
   * @param tlhocv an array of data in the form [ time, low, high, open, close, volume ]
   */
  constructor(tlhocv: Array<number>) {
      this.time = tlhocv[0];
      this.low = tlhocv[1];
      this.high = tlhocv[2];
      this.open = tlhocv[3];
      this.close = tlhocv[4];
      this.volume = tlhocv[5];
  }
}

const _bollingerBand = (upper: boolean, ma: number, deviations: number, stddev: number): number => {
    return upper ? (ma + (deviations * stddev)) : (ma - (deviations * stddev));
};

const _stddev = (sma: number, values: number[]): number => {
    const variance = values.reduce((acc, val) => acc + Math.pow((val - sma), 2), 0) / values.length;
    return Math.sqrt(variance);
};

/** A class for handling number streams with a mathematical boost */
export class Price extends Subject<number> {
  _subscription: Subscription | undefined;

  /**
   * Create a price stream, either to call next on manually or infer from an input stream
   * 
   * @param input if your price stream is coming from somewhere (like a candle stream) you can use input it here.
   * @param key will perform a 'pluck' on the input if provided
   */
  // eslint-disable-next-line
  constructor(input?: Subject<any> | Observable<any>, key?: string) {
      super();

      if (input) {
          const inputObs: Observable<number> | Subject<number> = key ? input.pipe(pluck(key)) : input;

          this._subscription = inputObs.subscribe((val: number) => {
              this.next(val);
          });
      }
  }

  _sma(values: number[]): number {
      return (values.reduce((a, b) => a + b, 0) / values.length);
  }


  /**
   * Take the simple moving average over a given period
   * 
   * @param period the length of time to take the average for, smoothing constant
   */
  sma(period: number): Price {
      const reducer = map((values: number[]) => {
          return this._sma(values);
      });

      return new Price(this.pipe(bufferCount(period, 1), reducer));
  }

  /** Shorthand for sma(5) */
  sma5(): Price {
      return this.sma(5);
  }

  /** Shorthand for sma(20) */
  sma20(): Price {
      return this.sma(20);
  }

  /** Shorthand for sma(30) */
  sma30(): Price {
      return this.sma(30);
  }

  /** Shorthand for sma(50) */
  sma50(): Price {
      return this.sma(50);
  }

  /** Shorthand for sma(100) */
  sma100(): Price {
      return this.sma(100);
  }

  /** Shorthand for sma(200) */
  sma200(): Price {
      return this.sma(200);
  }

  _ema(currentEma: number, val: number, smoothing: number): number {
      const commonTerm = smoothing;
      return val * commonTerm + currentEma * (1 - commonTerm);
  }

  /**
   * Take the exponential moving average over a given period
   * 
   * @param period the length of time to take the average for
   * @param smoothing the smoothing constant, defaults to 2/(period + 1)
   */
  ema(period: number, smoothing?: number): Price {
      const smoothingConstant = smoothing || 2/(period + 1);

      let currentEma = 0;
      const reducer = map((values: number[]) => {
          const len = values.length;

          // no EMA? Start with an SMA
          if (!currentEma) {
              if (values.length >= (period - 1)) {
                  currentEma = this._sma(values);
                  return currentEma;
              }

              return this._sma(values);
          } else {
              currentEma = this._ema(currentEma, values[len - 1], smoothingConstant);
              return currentEma;
          }
      });

      return new Price(this.pipe(bufferCount(period, 1), reducer));
  }

  /** Shorthand for ema(5) */
  ema5(): Price {
      return this.ema(5);
  }

  /** Shorthand for ema(20) */
  ema20(): Price {
      return this.ema(20);
  }

  /** Shorthand for ema(30) */
  ema30(): Price {
      return this.ema(30);
  }

  /** Shorthand for ema(50) */
  ema50(): Price {
      return this.ema(50);
  }

  /** Shorthand for ema(100) */
  ema100(): Price {
      return this.ema(100);
  }

  /** Shorthand for ema(200) */
  ema200(): Price {
      return this.ema(200);
  }


  /**
   * Create a single, simple moving average based Bollinger Band
   * 
   * @param upper true for an upper band, false for a lower band
   * @param period the length of time to take the moving average for
   * @param deviations the number of standard deviations to offset the band
   */
  bollingerBand(upper = true, period = 20, deviations = 2): Price {
      const reducer = map((values: number[]) => {
          const sma = this._sma(values);
          const stddev = _stddev(sma, values);

          return _bollingerBand(upper, sma, deviations, stddev);
      });

      return new Price(this.pipe(bufferCount(period, 1), reducer));
  }

  /**
   * Create a single, exponential moving average based Bollinger Band
   * 
   * @param upper true for an upper band, false for a lower band
   * @param period the length of time to take the moving average for
   * @param deviations the number of standard deviations to offset the band
   * @param smoothing the smoothing constant for the ema, defaults to 2/(period + 1)
   */
  bollingerBandEma(upper = true, period = 20, deviations = 2, smoothing?: number): Price {
      const smoothingConstant = smoothing || 2/(period + 1);

      let currentEma = 0;

      const reducer = map((values: number[]) => {
          let ema = 0;
          const len = values.length;
          // no EMA? Start with an SMA
          if (!currentEma) {
              if (len >= (period - 1)) {
                  currentEma = this._sma(values);
                  ema = currentEma;
              } else {
                  ema = this._sma(values);
              }
          } else {
              currentEma = this._ema(currentEma, values[len - 1], smoothingConstant);
              ema = currentEma;
          }
          const stddev = _stddev(ema, values);

          return _bollingerBand(upper, ema, deviations, stddev);
      });

      return new Price(this.pipe(bufferCount(period, 1), reducer));
  }

  /**
   * Returns a custom MACD indicator for 2 given periods.
   * Defined as EMA(lowerPeriod) - EMA(upperPeriod)
   * 
   * @param lowerPeriod the first, smaller period for the ema
   * @param upperPeriod the second, larger period for the ema 
   */
  macdOf(lowerPeriod = 12, upperPeriod = 26): Price {
      return new Price(zip(this.ema(lowerPeriod), this.ema(upperPeriod)).pipe(map(([ema1, ema2]) => ema1 - ema2)));
  }

  /**
   * Returns the MACD indicator, defined as the EMA(12) - EMA(26)
   */
  macd(): Price {
      return this.macdOf();
  }

  /**
   * Returns a custom MACD indicator for 2 given periods.
   * Defined as EMA(MACD(lowerPeriod, upperPeriod), signalPeriod)
   * 
   * @param lowerPeriod the first, smaller period for the ema
   * @param upperPeriod the second, larger period for the ema 
   * @param signalPeriod the period to base the signal value off of
   */
  macdSignalOf(lowerPeriod = 12, upperPeriod = 26, signalPeriod = 9): Price {
      return this.macdOf(lowerPeriod, upperPeriod).ema(signalPeriod);
  }

  /**
   * Returns the MACD signal, defined as EMA(MACD, 9)
   */
  macdSignal(): Price {
      return this.macdSignalOf();
  }

  /**
   * Returns the price rate of change, defined as:
   * 100 * (price(n) - price(n - p)) / price(n - p)
   * 
   * @param period the period to read the rate of change for
   */
  roc(period = 12): Price {
      const reducer = map((values: number[]) => {
          const firstPrice = values[0];
          const lastPrice = values[values.length - 1];

          return 100 * (lastPrice - firstPrice) / firstPrice;
      });

      return new Price(this.pipe(bufferCount(period + 1, 1), reducer));
  }

  /**
   * Uses the numeric value to calculate a stochastic oscillator, rather than the candles
   * Useful for calculating things like the stochastic RSI
   * 
   * @param period the period to read from
   */
  takeStoch(period = 14): Price {
      const reducer = map((values: number[]) => {
          const current = values[values.length - 1];
          
          let min = -1;
          let max = -1;

          for (const val of values) {
              if (min === -1 || val < min) min = val;
              if (max === -1 || val > max) max = val;
          }

          return (current - min)/(max - min);
      });

      return new Price(this.pipe(bufferCount(period, 1), reducer));
  }

  /**
   * Invert the price
   */
  inverse(): Price {
      return new Price(this.pipe(map((val) => 1/val)));
  }


  complete(): void {
      if (this._subscription) {
          this._subscription.unsubscribe();
      }
      super.complete();
  }
}

export class CoinbaseProPrice extends Price {
    constructor(product: CoinbaseProduct = CoinbaseProduct.ETH_USD) {
        super();

        const ws = new WS('wss://ws-feed.pro.coinbase.com');

        // eslint-disable-next-line
        ws.addEventListener('message', (ev: any) => {
            const data = JSON.parse(ev.data);

            const currentPrice = parseFloat(data.price);

            if (isNaN(currentPrice)) return;

            this.next(currentPrice);
        });

        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({
                type: 'subscribe',
                channels: [{name: 'ticker', product_ids: [product]}]
            }));
        });
    }
}

export const _fetchCandles = async (product: CoinbaseProduct, prefetch: number, period: CoinbaseGranularity, current: number, endTime?: number):Promise<Candle[]> => {
    const inputEndTime = endTime;
    const inputCurrent = current;

    // go forward one candle's worth
    const startDate = new Date(current);
    const startStr = startDate.toISOString();

    current += 300*period*1000;

    let cancel = false;
    if (!endTime) endTime = Date.now();
    if (endTime <= current) {
        current = endTime;
        cancel = true;
    }

    const endDate = new Date(current);
    const endStr = endDate.toISOString();

    log(LogLevel.INFO)(`fetching candles for ${product} ${startDate.toLocaleString()} to ${endDate.toLocaleString()}`);

    // bump cur by 1 more candle before updating so we don't overlap that minute
    current += period*1000;

    const query = 'start=' + startStr + '&end=' + endStr + '&granularity=' + period;

    let data;

    try {
        data = await axios.get(`${COINBASE_API}/products/${product}/candles?${query}`);
    } catch (e) {
        log(LogLevel.ERROR)('Got an error, likely hit API limits');
        const prom = new Promise<Candle[]>((resolve) => {
            setTimeout(async () => {
                resolve(await _fetchCandles(product, prefetch, period, inputCurrent, inputEndTime));
            }, 1500);
        });

        return await prom;
    }

    if (data) {
        const body = data.data;
        const snapshot = body.reverse().map((bucket: Array<number>) => {
            return new Candle(bucket);
        });
        if (!cancel) snapshot.push(...await _fetchCandles(product, prefetch, period, current, endTime));
        return snapshot;
    }

    return [];
};

export class Candles extends Subject<Candle> {
    time(): Observable<number> {
        return this.pipe(pluck('time'));
    }

    open(): Price {
        return new Price(this.pipe(pluck('open')));
    }

    close(): Price {
        return new Price(this.pipe(pluck('close')));
    }

    high(): Price {
        return new Price(this.pipe(pluck('high')));
    }

    low(): Price {
        return new Price(this.pipe(pluck('low')));
    }

    typical(): Price {
        return new Price(this.pipe(map((c: Candle) => (c.high + c.low + c.close)/3)));
    }

    gain(): Price {
        return new Price(this.pipe(map((c: Candle) => (c.close - c.open)/c.open)));
    }

    volume(): Price {
        return new Price(this.pipe(pluck('volume')));
    }

    /**
   * The stochastic %K, defined as:
   *  100 * (C - L(P))/(H(P) - L(P))
   * 
   * Where L(P) is the low price in the last P periods
   * and H(P) is the high price in the last P periods
   * 
   * @param period the period to compare to, default of 14
   */
    stoch(period = 14): Price {
        const reducer = map((values: Candle[]) => {
            const lowest = values.reduce((acc, val) => (val.low < acc || acc === -1) ? val.low : acc, -1);
            const highest = values.reduce((acc, val) => val.high > acc ? val.high : acc, -1);
            const lastValue = values[values.length - 1];

            return 100 * (lastValue.close - lowest) / (highest - lowest);
        });

        return new Price(this.pipe(bufferCount(period, 1), reducer));
    }

    /**
   * The stochastic %D, the <avgPeriod> period average of the stochastic %K
   * 
   * @param period the period to compare to, default of 14
   * @param avgPeriod the smoothing factor, default of 3
   */
    stochD(period = 14, avgPeriod = 3): Price {
        return this.stoch(period).ema(avgPeriod);
    }

    /**
   * The stochastic slow %K, defined as the stochastic fast %D
   * 
   * @param period the period to compare to, default of 14
   * @param avgPeriod the smoothing factor, default of 3
   */
    stochSlow(period = 14, avgPeriod = 3): Price {
        return this.stochD(period, avgPeriod);
    }

    /**
   * The stochastic slow %D, applies a second moving average to the stochastic slow %D
   * 
   * @param period the period to compare to, default of 14
   * @param avgPeriod the smoothing factor, default of 3
   * @param secondAvgPeriod the smoothing factor, default of 3
   */
    stochSlowD(period = 14, avgPeriod = 3, secondAvgPeriod = 3): Price {
        return this.stochSlow(period, avgPeriod).ema(secondAvgPeriod);
    }

    /**
     * The Relative Strength Index (RSI) is defined as:
     * RSI = 100 – 100 / (1 + RS)
     * RS = Average Gain of n days UP  / Average Loss of n days DOWN
     * 
     * @param period the period to compare against
     */
    rsi(period = 14): Price {
        const reducer = map((values: Candle[]) => {
            let upCount = 0;
            let upGain = 0;
            let downCount = 0;
            let downGain = 0;

            for (const value of values) {
                if (value.open > value.close) {
                    downCount++;
                    downGain -= (value.close - value.open) / value.open;
                } else {
                    upCount++;
                    upGain += (value.close - value.open) / value.open;
                }
            }

            const rs = (upGain / upCount) / (downGain / downCount);

            return 100 - (100 / (1 + rs));
        });

        return new Price(this.pipe(bufferCount(period, 1), reducer));
    }

    /**
     * The smoothed RSI is a slightly smoothed version of the RSI which uses
     * the previous values to weight the current value, much like an EMA does
     * compared to an SMA.
     * 
     * @param period the period to compare against
     */
    smoothedRsi(period = 14): Price {
        let previousAverageGain = 0;
        let previousAverageLoss = 0;
        const reducer = map((values: Candle[]) => {
            if (!previousAverageGain) {
                let upCount = 0;
                let upGain = 0;
                let downCount = 0;
                let downGain = 0;

                for (const value of values) {
                    if (value.open > value.close) {
                        downCount++;
                        downGain += (value.close - value.open) / value.open;
                    } else {
                        upCount++;
                        upGain += (value.close - value.open) / value.open;
                    }
                }

                previousAverageGain = upGain / upCount;
                previousAverageLoss = downGain / downCount;

                const rs = (previousAverageGain) / (previousAverageLoss);

                return 100 - 100 / (1 + rs);
            } else {
                const val = values[values.length - 1];
                if (val.open > val.close) {
                    previousAverageGain = (previousAverageGain * (period - 1)) / period;
                    previousAverageLoss = ((previousAverageLoss * (period - 1)) + ((val.close - val.open) / val.open))/period;
                } else {
                    previousAverageLoss = (previousAverageLoss * (period - 1)) / period;
                    previousAverageGain = ((previousAverageGain * (period - 1)) + ((val.close - val.open) / val.open))/period;
                }

                const rs = (previousAverageGain) / (previousAverageLoss);

                return 100 - 100 / (1 + rs);
            }
        });

        return new Price(this.pipe(bufferCount(period, 1), reducer));
    }

    /**
     * Returns the on balance volume stream, defined as:
     * 
     * OBV(n - 1) + {vol if close > open, - vol if close < open, 0 else}
     */
    obv(): Price {
        const scanner = scan((acc: number, val: Candle) => {
            if (val.close > val.open) {
                return acc + val.volume;
            } else if (val.close < val.open) {
                return acc - val.volume;
            }
            return acc;
        }, 0);

        return new Price(this.pipe(scanner));
    }

    _vwma(values: Candle[]): number {
        let volumeWeightedPrice = 0;
        let totalVolume = 0;

        for (const val of values) {
            if (!val) continue;
            const typical = (val.high + val.low + val.close)/3;
            const vol = val.volume;

            volumeWeightedPrice += typical * vol;
            totalVolume += vol;
        }

        return volumeWeightedPrice/totalVolume;
    }

    /**
     * The vwma or volume weighted moving average is a moving average
     * that weighs based on the trade volume in a given period to provide
     * a more dynamic view of price action.
     * 
     * @param period the period to take the average across
     */
    vwma(period = 14): Price {
        const reducer = map(this._vwma);
        return new Price(this.pipe(bufferCount(period, 1), reducer));
    }

    /**
     * Create a single, volume weighted moving average based Bollinger Band
     * 
     * @param upper true for an upper band, false for a lower band
     * @param period the length of time to take the moving average for
     * @param deviations the number of standard deviations to offset the band
     */
    volumeWeightedBollingerBand(upper = true, period = 20, deviations = 2): Price {
        const reducer = map((values: Candle[]) => {
            const sma = this._vwma(values);
            const stddev = _stddev(sma, values.map((val) => (val.high + val.low + val.close)/3));

            return _bollingerBand(upper, sma, deviations, stddev);
        });

        return new Price(this.pipe(bufferCount(period, 1), reducer));
    }

    /**
     * Returns a custom volume weighted MACD indicator for 2 given periods.
     * Defined as VWMA(lowerPeriod) - VWMA(upperPeriod)
     * 
     * @param lowerPeriod the first, smaller period for the vwma
     * @param upperPeriod the second, larger period for the vwma 
     */
    volumeWeightedMacdOf(lowerPeriod = 12, upperPeriod = 26): Price {
        return new Price(zip(this.vwma(lowerPeriod), this.vwma(upperPeriod)).pipe(map(([vwma1, vwma2]) => vwma1 - vwma2)));
    }

    /**
     * Returns the volume weighted MACD indicator, defined as the VWMA(12) - VWMA(26)
     */
    volumeWeightedMacd(): Price {
        return this.volumeWeightedMacdOf();
    }

    /**
     * Returns a custom VWMACD indicator for 2 given periods.
     * Defined as EMA(VWMACD(lowerPeriod, upperPeriod), signalPeriod)
     * 
     * @param lowerPeriod the first, smaller period for the ema
     * @param upperPeriod the second, larger period for the ema 
     * @param signalPeriod the period to base the signal value off of
     */
    volumeWeightedMacdSignalOf(lowerPeriod = 12, upperPeriod = 26, signalPeriod = 9): Price {
        return this.volumeWeightedMacdOf(lowerPeriod, upperPeriod).ema(signalPeriod);
    }

    /**
     * Returns the VWMACD signal, defined as EMA(VWMACD, 9)
     */
    volumeWeightedMacdSignal(): Price {
        return this.volumeWeightedMacdSignalOf();
    }

    /**
     * Returns the Money Flow Index, defined as
     * 
     * 100 - 100 / (1 + MFR)
     * 
     * Where MFR is:
     * <period> period positive money flow / <period> period negative money flow
     * 
     * @param period the period to take the money flow index on
     */
    mfi(period = 14): Price {
        const reducer = map((values: Candle[]) => {
            let positiveFlow = 0;
            let negativeFlow = 0;

            const last = values.shift() as Candle;
            let lastTypical = (last.close + last.high + last.low)/3;
            for (const val of values) {
                const typical = (val.close + val.high + val.low)/3;
                const rawMoneyFlow = typical * val.volume;
                if (typical > lastTypical) {
                    positiveFlow += rawMoneyFlow;
                } else {
                    negativeFlow += rawMoneyFlow;
                }
                lastTypical = typical;
            }

            if (!positiveFlow) positiveFlow = 1;
            if (!negativeFlow) negativeFlow = 1;

            const mfr = positiveFlow / negativeFlow;
            const mfi = 100 - (100 / (1 + mfr));
            return mfi;
        });

        return new Price(this.pipe(bufferCount(period + 1, 1), reducer));
    }

    /**
     * Returns the stochastic rsi oscillator, defined as
     * 
     * RSI - min(RSI) / (max(RSI) - min(RSI))
     * 
     * @param period the period to take the rsi and stoch against
     */
    stochRsi(period = 14): Price {
        return this.rsi(period).takeStoch(period);
    }
}

export class MappedCandles extends Candles {
    unsubscriber = new Subject<void>();
    constructor(source: Observable<Candle>) {
        super();

        source.pipe(takeUntil(this.unsubscriber)).subscribe((c) => this.next(c));
    }

    unsubscribe(): void {
        this.unsubscriber.next();
        this.unsubscriber.complete();
        super.unsubscribe();
    }
}

export class CoinbaseProCandles extends Candles {
  _timeout?: NodeJS.Timeout;
  _interval?: NodeJS.Timeout;
  _prefetch: number;

  ready: Subject<boolean> = new Subject<boolean>();
  current: Subject<boolean> = new Subject<boolean>();

  /**
   * Constructs and prefetches a Subject of historical CoinbaseProCandles
   * 
   * @param product A string of the Coinbase product to query for, defaults to 'ETH-USD'
   * @param prefetch The number of candles to prefetch
   * @param period The granularity, in seconds, of how large the candles are
   * @param timestamp For testing & simulation only, use to fetch a set number of historical candles starting at this timestamp
   */
  constructor(product: CoinbaseProduct = CoinbaseProduct.ETH_USD, prefetch = 300, period: CoinbaseGranularity = CoinbaseGranularity.MINUTE, timestamp?: number) {
      super();
      this._prefetch = prefetch;

      const startTime = timestamp || (Date.now() - (prefetch * period * 1000));
      const endTime = timestamp ? timestamp + (prefetch * period * 1000) : undefined;

      _fetchCandles(product, prefetch, period, startTime, endTime).then((candles: Array<Candle>) => {
          log(LogLevel.SUCCESS)('received the initial batch of candles');
          for (const candle of candles) {
              this.next(candle);
          }

          if (timestamp) {
              this.complete();
              return;
          }

          let lastTimestamp = candles[candles.length - 1].time;
          const now = Date.now() / 1000;
          const diff = now - lastTimestamp;
          let delay = (2 * period) - diff;

          if (delay < 0) delay = 0;
          else this.current.next(true);

          this._timeout = setTimeout(async () => {
              const timeoutCandles = await _fetchCandles(product, 2, period, (lastTimestamp + period)*1000);
              for (const candle of timeoutCandles) {
                  this.next(candle);
              }

              if (delay === 0) this.current.next(true);

              lastTimestamp = timeoutCandles[timeoutCandles.length - 1].time;

              this._timeout = setInterval(async () => {
                  this.ready.next(true);
                  const intervalCandles = await _fetchCandles(product, 2, period, (lastTimestamp + period)*1000);

                  if (intervalCandles.length) {
                      for (const candle of intervalCandles) {
                          this.next(candle);
                      }
    
                      lastTimestamp = intervalCandles[intervalCandles.length - 1].time;
                  }
              }, 1000 * period);
          }, 1000 * delay);
      });
  }

  unsubscribe(): void {
      if (this._interval) {
          clearInterval(this._interval);
      }

      if (this._timeout) {
          clearTimeout(this._timeout);
      }

      super.unsubscribe();
  }
}

export class CoinbaseProSimulation extends Subject<Record<string, Candle>> {
    _timestamp: number;
    products: CoinbaseProduct[];
    _time: number;
    _period: number;

    constructor(products: CoinbaseProduct[], period: CoinbaseGranularity = CoinbaseGranularity.DAY, time = 300, current = false) {
        super();

        let last = Date.now() - (time * period * 1000);
        if (last < COINBASE_EARLIEST_TIMESTAMP) {
            last = COINBASE_EARLIEST_TIMESTAMP;
        }

        if (current) {
            this._timestamp = last;
        } else {
            this._timestamp = Math.floor(Math.random() * (last - COINBASE_EARLIEST_TIMESTAMP)) + COINBASE_EARLIEST_TIMESTAMP;
        }

        this.products = products;
        this._time = time;
        this._period = period;
    }

    async init(): Promise<void> {
        const theBigDb: Record<string, Record<string, Candle>> = {};
        for (const product of this.products) {
            await new Promise<void>((res) => {
                const sim = new CoinbaseProCandles(product, this._time, this._period, this._timestamp);
                sim.subscribe((candle) => {
                    if (!theBigDb[candle.time]) theBigDb[candle.time] = {};
                    theBigDb[candle.time][product] = candle;
                });
                sim.subscribe({complete: () => res()});
            });
        }

        const timestamps = Object.keys(theBigDb).sort((a, b) => parseInt(a) - parseInt(b));

        for (const timestamp of timestamps) {
            super.next(theBigDb[timestamp]);
        }
    }
}

export class Decision<T> extends Subject<boolean> {
  _subscription: Subscription;

  constructor(a: Observable<T>, b: Observable<T>, operator: (valA: T, valB: T) => boolean) {
      super();

      this._subscription = combineLatest([a, b])
          .pipe(
              map(([mapValA, mapValB]) => operator(mapValA, mapValB)),
              bufferCount(2, 1),
              filter(([prev, curr]) => prev !== curr),
              map((arrVal) => arrVal[1])
          )
          .subscribe((decision: boolean) => {
              this.next(decision);
          });
  }

  complete(): void {
      this._subscription.unsubscribe();
      super.complete();
  }
}

export class Crossover extends Decision<number> {
    constructor(a: Price, b: Price) {
        super(a, b, (a, b) => a > b);
    }
}

export class NegativeCrossover extends Decision<number> {
    constructor(a: Price, b: Price) {
        super(a, b, (a, b) => a < b);
    }
}

export class Distance extends Subject<number> {
  _subscription: Subscription;

  constructor(a: Price, b: number) {
      super();

      this._subscription = a
          .pipe(
              map((val) => val - b)
          )
          .subscribe((decision: number) => {
              this.next(decision);
          });
  }

  inverse(): Observable<number> {
      return this.pipe(map((val) => 1/val));
  }

  complete(): void {
      this._subscription.unsubscribe();
      super.complete();
  }
}

// eslint-disable-next-line
export async function writeState(values: Record<string, Observable<any>>, writeObs: Observable<any>, filename: string): Promise<void> {
    // eslint-disable-next-line
    const state: Record<string, any> = {};

    for (const key in values) {
        state[key] = '';
        values[key].subscribe((val) => state[key] = val);
    }

    const keys = Object.keys(state);
    await promises.writeFile(filename, keys.join(',') + '\n');

    writeObs.subscribe(async () => {
        await promises.appendFile(filename, keys.map((key) => (state[key] || '')).join(',') + '\n');
    });
}

export function log(level: LogLevel): (val: string) => void {
    switch (level) {
    case LogLevel.ERROR:
        return (val: string) => console.log(chalk.bgRed('ERROR:') + '  ', val);
    case LogLevel.WARN:
        return (val: string) => console.log(chalk.bgYellow('WARN:') + '   ', val);
    case LogLevel.SUCCESS:
        return (val: string) => console.log(chalk.bgGreen('SUCCESS:'), val);
    default:
        return (val: string) => console.log(chalk.bgBlue('INFO:') + '   ', val);
    }
}

interface Wallet {
  dollars: number;
  coins: Record<string, number>;
  currentCoin: string;
  transactions: number;
  fees: number;
  startingPrice: number;
  endingPrice: number;

  buy(product: CoinbaseProduct, price?: number): void
  sell(price?: number): void

  marketBuy(product: CoinbaseProduct): void
  marketSell(): void

  limitBuy(product: CoinbaseProduct, price: number): void
  limitSell(price: number): void

  stopEntry(product: CoinbaseProduct, price: number): void
  stopLoss(price: number): void
}

interface CoinbaseAccount {
  id: string;
  currency: string;
  balance: string;
  available: string;
  hold: string;
  profile_id: string;
  trading_enabled: boolean;
}

export class CoinbaseWallet implements Wallet {
  dollars = 0;
  dollarStream = new Subject<number>();

  currentCoin = '';
  
  coins: Record<string, number> = {};
  coinStream = new Subject<number>();

  inMarket = false;

  // these are unused in this (non-sim) context
  transactions = 0;
  startingPrice = 0;
  endingPrice = 0;
  fees = 0;

  // eslint-disable-next-line
  async _signAndSend(endpoint: string, request?: any): Promise<any> {
      const method = request ? 'POST' : 'GET';

      const timestamp = Date.now() / 1000;

      let prehash = timestamp + method + endpoint;

      if (request) {
          prehash += JSON.stringify(request);
      }

      const key = Buffer.from(process.env.COINBASE_SECRET || '', 'base64');
      const hmac = crypto.createHmac('sha256', key);
      const signature = hmac.update(prehash).digest('base64');

      const headers = {
          'CB-ACCESS-KEY': process.env.COINBASE_API_KEY,
          'CB-ACCESS-SIGN': signature,
          'CB-ACCESS-TIMESTAMP': timestamp,
          'CB-ACCESS-PASSPHRASE': process.env.COINBASE_PASSPHRASE
      };

      if (method === 'POST') {
          return axios.post(COINBASE_API + endpoint, request, {headers}).catch((err) => log(LogLevel.ERROR)(err.response.data.message));
      } else {
          return axios.get(COINBASE_API + endpoint, {headers});
      }

      // TODO - adjust the account values based on the success/failure of this.
  }

  async init(): Promise<void> {
      const accountList = (await this._signAndSend('/accounts') || {}).data;

      const dollarAccount = accountList.find((val: CoinbaseAccount) => val.currency === 'USD');
      const coinAccount = accountList.find((val: CoinbaseAccount) => parseFloat(val.available) > .0001);

      this.dollars = parseFloat(dollarAccount.available);
      if (coinAccount) {
          this.coins = {[coinAccount.currency]: parseFloat(coinAccount.available)};
      }

      this.inMarket = !!coinAccount;

      if (this.inMarket) {
          this.currentCoin = coinAccount.currency;
      }
      log(LogLevel.SUCCESS)(`USD: ${this.dollars}, ${this.currentCoin.split('-')[0]}: ${this.coins}`);
      log(LogLevel.SUCCESS)(`In market: ${this.inMarket}`);
  }

  limitBuy(product: CoinbaseProduct, price: number): void {
      this._signAndSend('/orders', {
          product_id: product,
          type: 'limit',
          side: 'buy',
          price: price.toString(),
          funds: this.dollars.toFixed(2)
      });
  }

  marketBuy(product: CoinbaseProduct): void {
      log(LogLevel.INFO)(`buying $${this.dollars} worth of ETH at ${(new Date(Date.now())).toLocaleString()}`);
      this._signAndSend('/orders', {
          product_id: product,
          type: 'market',
          side: 'buy',
          funds: (Math.floor(this.dollars * 100)/100).toFixed(2)
      });
  }

  buy(product: CoinbaseProduct, price?: number): void {
      if (this.inMarket) return;
      if (price) this.limitBuy(product, price);
      else this.marketBuy(product);

      this.inMarket = true;
  }

  limitSell(price: number): void {
      this._signAndSend('/orders', {
          product_id: this.currentCoin,
          type: 'limit',
          side: 'sell',
          price: price.toString(),
          size: this.coins.toString()
      });
  }

  marketSell(): void {
      log(LogLevel.INFO)(`selling ${this.coins} worth of ETH at ${(new Date(Date.now())).toLocaleString()}`);
      this._signAndSend('/orders', {
          product_id: this.currentCoin,
          type: 'market',
          side: 'sell',
          size: this.coins.toString()
      });
  }

  stopLoss(price: number): void {
      console.log('WOULD BE PUTTING IN A STOP LOSS IF THAT WAS SUPPORTED!', price);
  }

  stopEntry(product: CoinbaseProduct, price: number): void {
      console.log('WOULD BE PUTTING IN A STOP ENTRY IF THAT WAS SUPPORTED!', price);
  }

  sell(price?: number): void {
      if (!this.inMarket) return;
      if (price) this.limitSell(price);
      else this.marketSell();

      this.inMarket = false;
  }
}

export class SimulationWallet implements Wallet {
    dollars = 1000;
    transactionFee = COINBASE_TRANSACTION_FEE;
    startingDollars = 1000;
    coins: Record<string, number> = {};
    currentCoin = '';
    sim!: CoinbaseProSimulation;
    startingPrice = 0;
    endingPrice = 0;
    transactions = 0;
    fees = 0;

    marketSellSub?: Subscription;
    marketBuySub?: Subscription;

    buy(product: CoinbaseProduct, price: number): void {
        if (this.marketBuySub) {
            this.marketBuySub.unsubscribe();
            this.marketBuySub = undefined;
        }

        this.currentCoin = product;

        const fee = this.transactionFee * this.dollars;
        this.coins[product] = (this.dollars - fee) / price;
        this.dollars = 0;

        this.fees += fee;
        this.transactions++;
    }

    sell(price: number): void {
        if (this.marketSellSub) {
            this.marketSellSub.unsubscribe();
            this.marketSellSub = undefined;
        }

        this.dollars = this.coins[this.currentCoin] * price;
        const fee = this.transactionFee*price*this.coins[this.currentCoin];
        this.dollars = (this.coins[this.currentCoin] * price) - fee;
        this.coins[this.currentCoin] = 0;

        this.currentCoin = '';

        this.fees += fee;
        this.transactions++;
    }

    marketBuy(product: CoinbaseProduct): void {
        if (this.marketBuySub) return;

        this.marketBuySub = this.sim.subscribe((result) => {
            this.buy(product, result[product].close || 0);
        });
    }

    marketSell(): void {
        // market sell already in progress
        if (this.marketSellSub) return;

        this.marketSellSub = this.sim.subscribe((result) => {
            if (this.currentCoin) {
                this.sell(result[this.currentCoin].close || 0);
            }
        });
    }

    limitBuy(product: CoinbaseProduct, price: number): void {
        console.log('LIMIT BUY NOT IMPLEMENTED', product, price);
    }

    limitSell(price: number): void {
        console.log('LIMIT SELL NOT IMPLEMENTED', price);
    }

    stopEntry(product: CoinbaseProduct, price: number): void {
        console.log('STOP ENTRY NOT IMPLEMENTED', product, price);
    }

    stopLoss(price: number): void {
        console.log('STOP LOSS NOT IMPLEMENTED', price);
    }

    get expected(): number {
        const entryFee = this.startingDollars * this.transactionFee;
        const entryCoin = (this.startingDollars - entryFee) / this.startingPrice;
        return (this.endingPrice * entryCoin) * (1 - this.transactionFee);
    }
    get netWorth(): number {
        return this.dollars || (this.endingPrice * this.coins['ETH-USD'] * (1 - this.transactionFee));
    }

    get profit(): number {
        return 100 * (this.netWorth - this.startingDollars)/this.startingDollars;
    }

    get expectedProfit(): number {
        return 100 * (this.expected - this.startingDollars)/this.startingDollars;
    }

    get profitOverReplacement(): number {
        return this.profit - this.expectedProfit;
    }
}

export class Broker {
    unsubscriber = new Subject<void>();
    _sim: CoinbaseProSimulation;
    _alg: (candle: Candles) => AlgorithmResult;
    _wallet: Wallet;
    
    _theBigDb: Record<string, Record<string, ExtendedAlgorithmResult>> = {};

    constructor(wallet: Wallet, sim: CoinbaseProSimulation, alg: (candle: Candles) => AlgorithmResult) {
        this._sim = sim;
        this._alg = alg;
        this._wallet = wallet;
    }

    async init(): Promise<void> {

        for (const product of this._sim.products) {
            const candles = new Candles();
            this._sim.pipe(takeUntil(this.unsubscriber), pluck(product), filter((val) => !!val)).subscribe((c) => candles.next(c));
            const algResult = this._alg(candles);

            if (!algResult.rank && product !== 'ETH-USD') continue;

            if (product === 'ETH-USD') {
                candles.pipe(takeUntil(this.unsubscriber)).subscribe((candle) => {
                    if (!this._wallet.startingPrice) this._wallet.startingPrice = candle.close;
                    this._wallet.endingPrice = candle.close;
                });
            }

            // rank, entrytarget, exittarget, entry, exit, entrystop, exitstop
            const observables: Record<string, Observable<number | boolean>> = {};

            if (algResult.rank) observables.rank = algResult.rank;
            if (algResult.entry) observables.entry = algResult.entry;
            if (algResult.entryTarget) observables.entryTarget = algResult.entryTarget;
            if (algResult.entryStop) observables.entryStop = algResult.entryStop;
            if (algResult.exit) observables.exit = algResult.exit;
            if (algResult.exitStop) observables.exitStop = algResult.exitStop;
            if (algResult.exitTarget) observables.exitTarget = algResult.exitTarget;

            candles.time().pipe(withLatestFrom(candles.close(), ...(Object.values(observables) as Observable<number|boolean>[]))).subscribe((untypedResult) => {
                const results = untypedResult as (number|boolean)[];
                const result: Record<string, number | boolean> = {};
                const keys = Object.keys(observables);

                keys.forEach((val, i) => {
                    const resultVal = results[i + 2] as number|boolean;
                    result[val] = resultVal;
                });

                result.close = results[1] as number;

                const intermediateAlgResult = result as ExtendedAlgorithmResult;

                const time = results[0] as number;

                if (!this._theBigDb[time]) this._theBigDb[time] = {};

                this._theBigDb[time][product] = intermediateAlgResult;
            });
        }
    }

    calculate(): void {
        const timestamps = Object.keys(this._theBigDb).sort((a, b) => parseInt(a) - parseInt(b));

        for (const timestamp of timestamps) {
            const val = this._theBigDb[timestamp];

            if (this._wallet.dollars) {
                // out of market
                let options = ['ETH-USD'];
                if (Object.keys(val).length > 1) {
                    options = Object.keys(val).filter((key) => val[key].entry).sort((a, b) => (val[b].rank || 0) - (val[a].rank || 0));
                }

                if (!val[options[0]]) continue;

                // TODO - stop/limit orders
                if (options.length && !val[options[0]].exit) {
                    this._wallet.buy(options[0] as CoinbaseProduct, val[options[0]].close);
                }
            } else {
                // in market
                if (val[this._wallet.currentCoin] && val[this._wallet.currentCoin].exit) {
                    this._wallet.sell(val[this._wallet.currentCoin].close);
                }
            }
        }
    }

    complete(): void {
        this.unsubscriber.next();
        this.unsubscriber.complete();
    }
}

export class ComparisonBroker {
    unsubscriber = new Subject<void>();
    _sim: CoinbaseProSimulation;
    _alg: (candle: Candles) => AlgorithmResult;
    _wallet: Wallet;
    constructor(wallet: Wallet, sim: CoinbaseProSimulation, alg: (candle: Candles) => AlgorithmResult) {
        this._sim = sim;
        this._alg = alg;
        this._wallet = wallet;
    }

    async init(): Promise<void> {
        const candles = new Candles();
        this._sim.pipe(takeUntil(this.unsubscriber), pluck('ETH-USD'), filter((val) => !!val)).subscribe((c) => candles.next(c));
        const algResult = this._alg(candles);
        // rank, entrytarget, exittarget, entry, exit, entrystop, exitstop
        const observables: Record<string, Observable<number | boolean>> = {};

        if (algResult.rank) observables.rank = algResult.rank;
        if (algResult.entry) observables.entry = algResult.entry;
        if (algResult.entryTarget) observables.entryTarget = algResult.entryTarget;
        if (algResult.entryStop) observables.entryStop = algResult.entryStop;
        if (algResult.exit) observables.exit = algResult.exit;
        if (algResult.exitStop) observables.exitStop = algResult.exitStop;
        if (algResult.exitTarget) observables.exitTarget = algResult.exitTarget;

        candles.time().pipe(withLatestFrom(candles.close(), ...(Object.values(observables) as Observable<number|boolean>[]))).subscribe((untypedResult) => {
            const results = untypedResult as (number|boolean)[];
            const result: Record<string, number | boolean> = {};
            const keys = Object.keys(observables);

            keys.forEach((val, i) => {
                const resultVal = results[i + 2] as number|boolean;
                result[val] = resultVal;
            });

            result.close = results[1] as number;

            if (!this._wallet.startingPrice) this._wallet.startingPrice = result.close;
            this._wallet.endingPrice = result.close;

            if (this._wallet.dollars && result.entry) {
                // TODO - stop and limit orders
                this._wallet.buy(CoinbaseProduct.ETH_USD, result.close);
            } else if (!this._wallet.dollars && result.exit) {
                this._wallet.sell(result.close);
            }
        });
    }

    complete(): void {
        this.unsubscriber.next();
        this.unsubscriber.complete();
    }
}

export function safeStop(entry: Observable<boolean>, candles: Candles): Observable<number> {
    return entry.pipe(withLatestFrom(candles), bufferCount(2, 1), map(([prev, curr]) => {
        const [prevVal, prevCandle] = prev;
        const [currVal] = curr;
        if (!prevVal && currVal) {
            return prevCandle.low;
        }

        return 0;
    }), filter((val) => !!val));
}

export function maxStop(entry: Observable<boolean>, candles: Candles, stop = 30): Observable<number> {
    return entry.pipe(withLatestFrom(candles), map(([val, candle]) => {
        if (val) {
            return candle.open * (100 - stop) / 100;
        }

        return 0;
    }), filter((val) => !!val));
}

export function condenseCandles(c: Candles): Candles {
    const ratio = CoinbaseGranularity.DAY / CoinbaseGranularity.HOUR;

    const candleMap = c.pipe(skipWhile((c) => {
        const time = c.time;
        const timeSinceMidnight = time % (24 * 60 * 60);
        // 1 hour before the close of the day
        const timeToSkipTo = CoinbaseGranularity.DAY - CoinbaseGranularity.HOUR;
        const returnVal = timeSinceMidnight !== timeToSkipTo;

        return returnVal;
    }), bufferCount(ratio, ratio), map((values) => {
        // tlhocv: Array<number>
        const tlhocv = [
            values[0].time,
            Math.min(...values.map((val) => val.low)),
            Math.max(...values.map((val) => val.high)),
            values[0].open,
            values[values.length - 1].close,
            values.reduce((tv, v) => tv + v.volume, 0)
        ];
        return new Candle(tlhocv);
    }));

    const candles = new MappedCandles(candleMap);
    return candles;
}

export function jumpCandles(c: Candles): Candles {
    const ratio = CoinbaseGranularity.DAY / CoinbaseGranularity.HOUR;

    const candleMap = c.pipe(skipWhile((c) => {
        const time = c.time;
        const timeSinceMidnight = time % (24 * 60 * 60);
        // 2 hours before the close of the day
        const timeToSkipTo = CoinbaseGranularity.DAY - (2*CoinbaseGranularity.HOUR);
        const returnVal = timeSinceMidnight !== timeToSkipTo;

        return returnVal;
    }), bufferCount(ratio, ratio), map((values) => {
        return values[values.length - 1];
    }));

    const candles = new MappedCandles(candleMap);
    return candles;
}