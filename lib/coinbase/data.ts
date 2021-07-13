import { Subject } from 'rxjs';
import axios from 'axios';
import WS from 'ws';

import { Price, Candle, Candles, log } from "../lib";
import { LogLevel, Granularity } from "../constants";
import { CoinbaseProduct, COINBASE_EARLIEST_TIMESTAMP, COINBASE_API } from "./constants";

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

const _fetchCandles = async (product: CoinbaseProduct, prefetch: number, period: Granularity, current: number, endTime?: number):Promise<Candle[]> => {
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
        // todo - this eventually hits a recursion limit
        if (!cancel) snapshot.push(...await _fetchCandles(product, prefetch, period, current, endTime));
        return snapshot;
    }

    return [];
};

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
  constructor(product: CoinbaseProduct = CoinbaseProduct.ETH_USD, prefetch = 300, period: Granularity = Granularity.MINUTE, timestamp?: number) {
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

    constructor(products: CoinbaseProduct[], period: Granularity = Granularity.DAY, time = 300, current = false) {
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

    // TODO - this is not sustainable
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