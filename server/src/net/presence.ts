/**
 * Which zones have a live room and which accounts are standing in one. The money routes
 * read this to refuse anything that, online, only the room may do.
 */

const zones = new Map<string, number>();
const accounts = new Map<string, number>();

const bump = (map: Map<string, number>, key: string, by: number): void => {
  const n = (map.get(key) ?? 0) + by;
  if (n > 0) map.set(key, n);
  else map.delete(key);
};

export const openZone = (zone: string): void => bump(zones, zone, 1);
export const closeZone = (zone: string): void => bump(zones, zone, -1);
export const enterRoom = (accountId: string): void => bump(accounts, accountId, 1);
export const leaveRoom = (accountId: string): void => bump(accounts, accountId, -1);

/** True while a room is open for the zone: its kills, piles and deaths are the room's. */
export const isZoneOnline = (zone: string): boolean => zones.has(zone);
/** True while the account is in any zone room: its trades go through that room. */
export const isInRoom = (accountId: string): boolean => accounts.has(accountId);

/** Clears everything, for tests. */
export function resetPresence(): void {
  zones.clear();
  accounts.clear();
}
