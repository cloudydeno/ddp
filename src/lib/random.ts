// import {default as Alea} from 'jsr:@iv/alea@1.1.0';
import { Alea } from './_alea.ts';

// subset of https://github.com/meteor/meteor/blob/02aa69c0c2d2c3ea805ba8bcf0dbaa565ca995b3/packages/random/AbstractRandomGenerator.js
export class Random {
  static readonly UNMISTAKABLE_CHARS = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';
  static readonly BASE64_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  constructor(
    private readonly prng: Alea = new Alea(),
  ) {}
  static fromSeed(seeds: string[]): Random {
    return new this(new Alea({seed: seeds}));
  }
  fraction(): number {
    return this.prng.random();
  }
  hexString(digits: number): string {
    return this._randomString(digits, '0123456789abcdef');
  }
  _randomString(charsCount: number, alphabet: string): string {
    let result = '';
    for (let i = 0; i < charsCount; i++) {
      result += this.choice(alphabet);
    }
    return result;
  }
  id(charsCount = 17): string {
    // 17 characters is around 96 bits of entropy, which is the amount of
    // state in the Alea PRNG.
    return this._randomString(charsCount, Random.UNMISTAKABLE_CHARS);
  }
  secret(charsCount = 43): string {
    // Default to 256 bits of entropy, or 43 characters at 6 bits per
    // character.
    return this._randomString(charsCount, Random.BASE64_CHARS);
  }
  choice(arrayOrString: string | string[]): string {
    const index = Math.floor(this.fraction() * arrayOrString.length);
    return arrayOrString[index];
  }
}

export class RandomStream {
  constructor(
    private readonly seed: string,
  ) {}
  streams: Map<string, Random> = new Map;
  // name: /collection/MyTasks
  // name: /rpc/my-method
  getStream(name: string): Random {
    let stream = this.streams.get(name);
    if (!stream) {
      stream = Random.fromSeed([this.seed, name]);
      this.streams.set(name, stream);
    }
    return stream;
  }
}

// console.log(Random.fromSeed(['ef2dd7badfbe6931a1e9']).id());
// console.log(Random.fromSeed(['ef2dd7badfbe6931a1e9','/collection/Tasks']).id());
// console.log(new RandomStream('ef2dd7badfbe6931a1e9').getStream('/collection/Tasks').id());
