import { MapSchema, Schema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') z: number = 0;
  @type('number') facing: number = 0;
  @type('string') element: string = 'IGNIS';
  @type('string') role: string = 'Shaper';
  @type('number') health: number = 120;
  @type('number') maxHealth: number = 120;
  @type('string') action: string = '';
}

export class MonsterState extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') z: number = 0;
  @type('number') facing: number = 0;
  @type('string') element: string = 'TERRA';
  @type('number') health: number = 60;
  @type('number') maxHealth: number = 60;
  @type('string') state: string = 'spawn';
}

export class ZoneState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: MonsterState }) monsters = new MapSchema<MonsterState>();
}
