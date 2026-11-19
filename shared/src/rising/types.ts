import type { Element } from '../combat/types.js';

export type RisingRole = 'Shaper' | 'Hush';

export type RisingResult =
  /** A Hush bends nothing; `element` is the nation their second draw gave them. */
  | { role: 'Hush'; element: Element }
  | { role: 'Shaper'; element: Element };
