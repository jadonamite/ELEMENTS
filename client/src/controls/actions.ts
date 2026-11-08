import balance from '../../../shared/balance.json';
import { createCombatRules, type CombatBalance, type MoveId } from '../../../shared/src/index.js';
import type { ControlAction } from '../../../shared/src/controls/index.js';
export type { ControlAction } from '../../../shared/src/controls/index.js';
export type InputDevice = 'desktop' | 'touch';
export type ControlGroup = 'Moving' | 'Fighting' | 'Bending' | 'The world';
export interface ActionDefinition {
  id: ControlAction; label: string; group: ControlGroup; key: string; touch: string;
  hint?: 'Tap' | 'Hold' | 'Swipe' | 'Drag'; move?: MoveId; shaper?: boolean; hush?: boolean;
}
export const ACTIONS: readonly ActionDefinition[] = [
  { id: 'move', label: 'Move', group: 'Moving', key: 'WASD', touch: 'Move', hint: 'Drag' },
  { id: 'look', label: 'Look around', group: 'Moving', key: 'mouse-move', touch: 'Look', hint: 'Swipe' },
  { id: 'run', label: 'Run', group: 'Moving', key: 'Shift', touch: 'Run', hint: 'Hold' },
  { id: 'jump', label: 'Jump · tap again in the air to rise higher', group: 'Moving', key: 'Space', touch: 'Jump' },
  { id: 'strike', label: 'Strike', group: 'Fighting', key: 'mouse-left', touch: 'Strike', move: 'light_1' },
  { id: 'heavy', label: 'Heavy strike', group: 'Fighting', key: 'mouse-right', touch: 'Heavy', move: 'heavy_1' },
  { id: 'block', label: 'Block', group: 'Fighting', key: 'R', touch: 'Guard', hint: 'Hold' },
  { id: 'parry', label: 'Parry · raise guard as the blow lands', group: 'Fighting', key: 'R', touch: 'Guard' },
  { id: 'dodge', label: 'Dodge', group: 'Fighting', key: 'Alt', touch: 'Dodge', move: 'dodge' },
  { id: 'lock', label: 'Lock onto a foe', group: 'Fighting', key: 'Tab', touch: 'Foe' },
  { id: 'weapon', label: 'Draw weapon', group: 'Fighting', key: '1', touch: 'Weapon' },
  { id: 'hands', label: 'Fight with hands', group: 'Fighting', key: '2', touch: 'Hands' },
  { id: 'legs', label: 'Fight with legs', group: 'Fighting', key: '3', touch: 'Legs' },
  { id: 'stance', label: 'Switch weapon / hands', group: 'Fighting', key: 'X', touch: 'Stance' },
  { id: 'bending', label: 'Turn bending on / off', group: 'Bending', key: 'B', touch: 'Bend', move: 'bend_palm', shaper: true },
  { id: 'rise', label: 'Rise', group: 'Bending', key: 'Q', touch: 'Rise', move: 'uppercut', shaper: true },
  { id: 'ground', label: 'Ground strike · interacts when an offer is shown', group: 'Bending', key: 'E', touch: 'Ground', move: 'ground_pound', shaper: true },
  { id: 'bend_move', label: 'Bending move', group: 'Bending', key: 'F', touch: 'Dash', move: 'dash_strike', shaper: true },
  { id: 'ultimate', label: 'Ultimate', group: 'Bending', key: 'G', touch: 'Ultimate', move: 'ultimate', shaper: true },
  { id: 'spark', label: 'Throw a shard spark', group: 'Bending', key: 'T', touch: 'Spark', move: 'shard_spark', hush: true },
  { id: 'technique', label: 'Element technique', group: 'Bending', key: 'V', touch: 'Technique', shaper: true },
  { id: 'interact', label: 'Talk or pick up', group: 'The world', key: 'E', touch: 'Interact' },
  { id: 'duel', label: 'Challenge a fighter', group: 'The world', key: 'K', touch: 'Challenge' },
  { id: 'menu', label: 'Open menu and help', group: 'The world', key: 'Esc', touch: 'Menu' },
];
const rules = createCombatRules(balance.combat as unknown as CombatBalance);
export const definition = (id: ControlAction): ActionDefinition => ACTIONS.find(a => a.id === id)!;
export function availableActions(tier: number, hush: boolean, online = false): ActionDefinition[] {
  return ACTIONS.filter(a => (!a.move || rules.tierAllows(a.move, tier)) &&
    !(a.shaper && hush) && !(a.hush && !hush) && !(a.id === 'duel' && online));
}
export const KEY_BINDINGS: Readonly<Record<string, ControlAction>> = {
  KeyW: 'move', KeyA: 'move', KeyS: 'move', KeyD: 'move', ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump', Tab: 'lock', Digit1: 'weapon', Numpad1: 'weapon', Digit2: 'hands', Numpad2: 'hands',
  Digit3: 'legs', Numpad3: 'legs', KeyX: 'stance', KeyB: 'bending', KeyE: 'interact',
  KeyQ: 'rise', KeyT: 'spark', KeyF: 'bend_move', KeyG: 'ultimate', KeyR: 'block', AltLeft: 'dodge', AltRight: 'dodge',
  KeyC: 'interact', KeyK: 'duel', KeyV: 'technique', Escape: 'menu',
};
