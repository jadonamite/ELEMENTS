export function formatNumberWord(n: number): string {
  const words: Record<number, string> = {
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
    6: 'Six',
    7: 'Seven',
    8: 'Eight',
    9: 'Nine',
    10: 'Ten',
    12: 'Twelve',
    15: 'Fifteen',
    20: 'Twenty',
    25: 'Twenty-five',
    30: 'Thirty',
    40: 'Forty',
    50: 'Fifty',
    60: 'Sixty',
    70: 'Seventy',
    80: 'Eighty',
    90: 'Ninety',
    100: 'A hundred',
  };
  return words[n] ?? `${n}`;
}

export function formatItemDisplay(itemType: string, nation = 'IGNIS'): string {
  const normalized = itemType.toLowerCase();
  if (normalized.includes('shard')) {
    if (normalized.includes('ignis') || normalized.includes('crimson') || nation === 'IGNIS') {
      return 'Crimson shards';
    }
    if (normalized.includes('aques') || normalized.includes('azure') || nation === 'AQUES') {
      return 'Azure shards';
    }
    if (normalized.includes('terra') || normalized.includes('ochre') || nation === 'TERRA') {
      return 'Ochre shards';
    }
    if (normalized.includes('aura') || normalized.includes('white') || nation === 'AURA') {
      return 'Pale white shards';
    }
    return 'shards';
  }
  if (normalized.includes('potion')) return 'potions';
  if (normalized.includes('item')) return 'gear';
  return itemType;
}

export function voiceScarcity(params: {
  action: 'buy' | 'sell';
  stock: number;
  maxStock: number;
  itemType: string;
  nation?: string;
}): string {
  const { action, stock, maxStock, itemType, nation } = params;
  const ratio = maxStock > 0 ? stock / maxStock : 1;
  const item = formatItemDisplay(itemType, nation);

  if (action === 'buy') {
    if (ratio <= 0.25) {
      return "The Lord's cart took my stock yesterday; what's left costs more.";
    }
    if (ratio <= 0.6) {
      return `Stock is running down on ${item}; prices are climbing.`;
    }
    return `Shelves are well stocked with ${item}; standard rates today.`;
  } else {
    if (ratio >= 0.8) {
      return `I have a back room full of ${item}; I cannot pay you much for more.`;
    }
    if (ratio <= 0.3) {
      return `My racks are nearly empty of ${item}; I will pay well for whatever you bring.`;
    }
    return `A fair supply of ${item} on hand; I pay the going rate today.`;
  }
}

export function voiceDemand(params: {
  action: 'buy' | 'sell';
  netUnits: number;
  itemType: string;
  nation?: string;
}): string {
  const { action, netUnits, itemType, nation } = params;
  const item = formatItemDisplay(itemType, nation);
  const count = Math.abs(netUnits);
  const countWord = formatNumberWord(count);

  if (action === 'sell') {
    if (netUnits > 0) {
      return `${countWord} ${item} came over my counter today; I pay less for them now.`;
    }
    if (netUnits < 0) {
      return `Fighters have been buying up ${item} all day; I will pay extra to restock.`;
    }
    return `Trade in ${item} has been steady today.`;
  } else {
    if (netUnits < 0) {
      return `Buyers have been clearing out ${item} all day; the remaining stock comes dear.`;
    }
    if (netUnits > 0) {
      return `So many ${item} came through the door today that what is on the shelf is discounted.`;
    }
    return `Steady trade on ${item} throughout the district today.`;
  }
}

export function voiceColorBalance(params: {
  action: 'buy' | 'sell';
  dominantColor: string;
  counterColor: string;
  isDominant: boolean;
  isCounter: boolean;
}): string {
  const { isDominant, isCounter, dominantColor, counterColor } = params;
  if (isDominant) {
    return `Everyone is dragging ${dominantColor} shards from the field; the market is choked with them and I pay less.`;
  }
  if (isCounter) {
    return `Hardly anyone brings in ${counterColor} shards; I will pay a premium for them.`;
  }
  return 'The four shard colours are moving evenly through the city market.';
}

export function voiceOutsider(params: {
  action: 'buy' | 'sell';
  isOutsider: boolean;
}): string {
  const { action, isOutsider } = params;
  if (action === 'buy') {
    if (isOutsider) {
      return 'Outsiders from beyond our gates pay the high gate tax.';
    }
    return 'You walk our streets; citizen rates for you.';
  } else {
    if (isOutsider) {
      return 'I do not know your clan; outsider goods earn less on my counter.';
    }
    return 'Local hands bring good work; fair coin for our own.';
  }
}

export function voiceNpcMemory(params: {
  action: 'buy' | 'sell';
  score: number;
}): string {
  const { score } = params;
  if (score > 30) {
    return 'You have treated this stall well in the past; take my friend rate.';
  }
  if (score < -30) {
    return 'I remember the grief you caused here; you pay for that trouble.';
  }
  return 'Business is business between us.';
}
