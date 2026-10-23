'use strict';

/** Selectable play orders. 'random' shuffles; the others follow a fixed sequence. */
const SORT_ORDERS = ['random', 'name-asc', 'name-desc', 'date-asc', 'date-desc'];

function needsDates(sortOrder) {
  return sortOrder === 'date-asc' || sortOrder === 'date-desc';
}

/**
 * Fixed play sequence (indices into `media`) for a sort order, or null for
 * 'random'. `media` must already be in the scanner's name order; date orders
 * additionally need `item.date` on every item. Ties keep name order (stable sort).
 */
function buildSequence(media, sortOrder) {
  const idx = media.map((_, i) => i);
  switch (sortOrder) {
    case 'name-asc': return idx;
    case 'name-desc': return idx.reverse();
    case 'date-asc': return idx.sort((a, b) => media[a].date - media[b].date);
    case 'date-desc': return idx.sort((a, b) => media[b].date - media[a].date);
    default: return null;
  }
}

/**
 * Manages the play order over a set of media items.
 *
 * `order` is a permutation of indices into the media array. With a fixed
 * sequence (sorted by name/date) it simply loops. Without one it is a shuffle:
 * when exhausted we reshuffle, guaranteeing that the first item of the new
 * round is not the same image that just played (no visible repeat).
 */
class Playlist {
  constructor() {
    this.count = 0;
    this.sequence = null; // fixed play order, or null to shuffle
    this.order = [];      // indices into the media array
    this.pos = 0;         // pointer into `order`
  }

  /** Reset for a new media set of `count` items and build the first round. */
  load(count, sequence = null) {
    this.count = count;
    this.sequence = sequence;
    this.pos = 0;
    if (sequence) this.order = sequence.slice();
    else this._reshuffle(-1);
  }

  /**
   * Switch to a new order mid-show without a jump: the current image stays on
   * screen and the next one follows the new order from there.
   */
  reorder(sequence) {
    this.sequence = sequence;
    if (this.count === 0) return;
    const cur = this.current;
    if (sequence) {
      this.order = sequence.slice();
      this.pos = Math.max(0, this.order.indexOf(cur));
    } else {
      this._reshuffle(-1);
      const at = this.order.indexOf(cur);
      [this.order[0], this.order[at]] = [this.order[at], this.order[0]];
      this.pos = 0;
    }
  }

  get current() {
    if (this.count === 0) return -1;
    return this.order[this.pos];
  }

  /** Advance to the next image (loops a fixed order, reshuffles a random one). */
  next() {
    if (this.count === 0) return -1;
    if (this.pos >= this.order.length - 1) {
      if (!this.sequence) this._reshuffle(this.current);
      this.pos = 0;
    } else {
      this.pos += 1;
    }
    return this.current;
  }

  /**
   * Go back one step. A fixed order wraps around to its end; a shuffle stops
   * at the start of the current round (the previous round is gone).
   */
  prev() {
    if (this.count === 0) return -1;
    if (this.pos > 0) this.pos -= 1;
    else if (this.sequence) this.pos = this.order.length - 1;
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

module.exports = { Playlist, SORT_ORDERS, needsDates, buildSequence };
