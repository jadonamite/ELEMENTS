import type { Element } from '../combat/types.js';

export type RisingRole = 'Shaper' | 'Hush';

export type RisingResult =
  | { role: 'Hush'; element?: never }
  | { role: 'Shaper'; element: Element };
