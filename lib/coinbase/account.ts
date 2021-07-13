import axios from "axios";
import crypto from "crypto";
import { Subject } from "rxjs";

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