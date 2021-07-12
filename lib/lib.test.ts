import { Subject } from 'rxjs';
import { first } from 'rxjs/operators';
import { Price } from './lib';


describe('Price', () => {
    describe('constructor', () => {
        test('initializes in the base case', () => {
            expect(new Price()).toBeDefined();
        });

        test('initializes with a source observable', (done) => {
            const subject = new Subject<number>();
            const price = new Price(subject);
            expect(price).toBeDefined();

            const subscription = price.pipe(first()).subscribe((val: number) => {
                expect(val).toBe(10);
                subscription.unsubscribe();
                price.complete();
                done();
            });

            subject.next(10);
            subject.next(11);
        });
    });

    describe('_sma', () => {
        test('sma of one value is that value', () => {
            const price = new Price();
            expect(price._sma([1])).toBe(1);
        });

        test('sma of 1, 2, 3 is 2', () => {
            const price = new Price();
            expect(price._sma([1, 2, 3])).toBe(2);
        });
    });

    describe('_stddev', () => {
        test('stddev of one value is 0', () => {
            const price = new Price();
            const vals = [1];
            expect(price._stddev(price._sma(vals), vals)).toBe(0);
        });

        test('stddev of 1, 2, 3 is sqrt(2/3)', () => {
            const price = new Price();
            const vals = [1, 2, 3];
            expect(price._stddev(price._sma(vals), vals)).toBe(Math.sqrt(2/3));
        });
    });

    describe('sma', () => {
        test('skips the first <period> values and calculates the right value', (done) => {
            const subject = new Subject();
            const price = new Price(subject);
            const sma3 = price.sma(3);

            const subscription = sma3.pipe(first()).subscribe((val: number) => {
                expect(val).toBe(2);
                subscription.unsubscribe();
                price.complete();
                done();
            });

            subject.next(1);
            subject.next(2);
            subject.next(3);
        });
    });

    describe('smaN', () => {
        test('sma5', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma5();
            expect(spy).toBeCalledWith(5);
        });

        test('sma20', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma20();
            expect(spy).toBeCalledWith(20);
        });

        test('sma30', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma30();
            expect(spy).toBeCalledWith(30);
        });

        test('sma50', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma50();
            expect(spy).toBeCalledWith(50);
        });

        test('sma100', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma100();
            expect(spy).toBeCalledWith(100);
        });

        test('sma200', () => {
            const price = new Price();
            const spy = spyOn(price, 'sma');
            price.sma200();
            expect(spy).toBeCalledWith(200);
        });
    });

    describe('_ema', () => {
        test('ema of 1, 1, n returns 1', () => {
            const price = new Price();
            expect(price._ema(1, 1, .5)).toBe(1);
        });

        test('ema of 500, 550, 2/5 returns expected value', () => {
            const price = new Price();
            expect(price._ema(500, 550, 2/5)).toBe(520);
        });
    });
});