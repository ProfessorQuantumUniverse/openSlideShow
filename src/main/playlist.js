'use strict';

/**
 * Manages the randomised play order over a set of media items.
 *
 * The playlist is a shuffled permutation of indices into the media array.
 * When it is exhausted we reshuffle, guaranteeing that the first item of the
 * new round is not the same image that just played (no visible repeat).
 */
class Playlist {
  constructor() {
    this.count = 0;
    this.order = [];   // shuffled indices into the media array
    this.pos = 0;      // pointer into `order`
  }

  /** Reset for a new media set of `count` items and build the first shuffle. */
  load(count) {
    this.count = count;
    this.pos = 0;
    this._reshuffle(-1);
  }

  get current() {
    if (this.count === 0) return -1;
    return this.order[this.pos];
  }

  /** Advance to the next image (reshuffles + wraps when exhausted). */
  next() {
    if (this.count === 0) return -1;
    if (this.pos >= this.order.length - 1) {
      const last = this.current;
      this._reshuffle(last);
      this.pos = 0;
    } else {
      this.pos += 1;
    }
    return this.current;
  }

  /** Go back one step. Stops at the start of the current shuffle round. */
  prev() {
    if (this.count === 0) return -1;
    if (this.pos > 0) this.pos -= 1;
    return this.current;
  }

  /** Fisher–Yates shuffle; if `avoidFirst` is set, ensure it isn't index 0. */
  _reshuffle(avoidFirst) {
    const arr = Array.from({ length: this.count }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (this.count > 1 && arr[0] === avoidFirst) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    this.order = arr;
  }
}

module.exports = { Playlist };
