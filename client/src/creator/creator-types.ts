/**
 * Character creation types and preset registries.
 * Strictly adheres to preset options (no free-form sliders that can corrupt the humanoid mesh).
 */

export type Sex = 'female' | 'male';

export type BodyPreset = 'lean' | 'average' | 'broad' | 'heavy';

export type HairStyleId =
  | 'none'
  | 'buzzed'
  | 'simple_parted'
  | 'long'
  | 'buns'
  | 'beard';

export interface SkinTonePreset {
  readonly id: string;
  readonly name: string;
  readonly hex: string;
  readonly color: number;
}

export interface HairColorPreset {
  readonly id: string;
  readonly name: string;
  readonly hex: string;
  readonly color: number;
}

export interface HairStyleOption {
  readonly id: HairStyleId;
  readonly name: string;
  readonly assetFile: string | null;
  readonly allowedSex: readonly Sex[];
}

export interface BodyPresetOption {
  readonly id: BodyPreset;
  readonly name: string;
  readonly description: string;
  readonly scale: readonly [number, number, number];
}

export interface CharacterConfig {
  sex: Sex;
  skinToneId: string;
  hairStyleId: HairStyleId;
  hairColorId: string;
  bodyPreset: BodyPreset;
}

export const STORAGE_CHARACTER_KEY = 'elements_character';

/**
 * 12 calibrated human skin tones spanning deep melanin to fair porcelain tones.
 * Universal and not tied to any elemental nation.
 */
export const SKIN_TONE_PRESETS: readonly SkinTonePreset[] = [
  { id: 'ebony', name: 'Deep Ebony', hex: '#261712', color: 0x261712 },
  { id: 'espresso', name: 'Dark Espresso', hex: '#3d251a', color: 0x3d251a },
  { id: 'cocoa', name: 'Deep Cocoa', hex: '#523423', color: 0x523423 },
  { id: 'chestnut', name: 'Warm Chestnut', hex: '#68422c', color: 0x68422c },
  { id: 'umber', name: 'Rich Umber', hex: '#7f5237', color: 0x7f5237 },
  { id: 'bronze', name: 'Burnished Bronze', hex: '#956344', color: 0x956344 },
  { id: 'caramel', name: 'Warm Caramel', hex: '#ab7552', color: 0xab7552 },
  { id: 'amber', name: 'Golden Amber', hex: '#bf8862', color: 0xbf8862 },
  { id: 'olive', name: 'Warm Olive', hex: '#d19d77', color: 0xd19d77 },
  { id: 'almond', name: 'Sunlit Almond', hex: '#e0b28e', color: 0xe0b28e },
  { id: 'peach', name: 'Warm Peach', hex: '#ecc6a7', color: 0xecc6a7 },
  { id: 'porcelain', name: 'Porcelain Ivory', hex: '#f7dfce', color: 0xf7dfce },
];

/**
 * 11 realistic human hair color presets.
 */
export const HAIR_COLOR_PRESETS: readonly HairColorPreset[] = [
  { id: 'jet_black', name: 'Jet Black', hex: '#141416', color: 0x141416 },
  { id: 'dark_brown', name: 'Espresso Brown', hex: '#281a13', color: 0x281a13 },
  { id: 'chestnut_brown', name: 'Chestnut Brown', hex: '#442a1c', color: 0x442a1c },
  { id: 'warm_amber', name: 'Amber Brown', hex: '#5e3a24', color: 0x5e3a24 },
  { id: 'auburn', name: 'Auburn Copper', hex: '#73321d', color: 0x73321d },
  { id: 'copper_red', name: 'Rustic Copper', hex: '#8c3d23', color: 0x8c3d23 },
  { id: 'honey_blonde', name: 'Honey Blonde', hex: '#b8905b', color: 0xb8905b },
  { id: 'ash_blonde', name: 'Ash Blonde', hex: '#cbb085', color: 0xcbb085 },
  { id: 'platinum', name: 'Platinum Fair', hex: '#e6dac7', color: 0xe6dac7 },
  { id: 'silver', name: 'Slate Grey', hex: '#8f9298', color: 0x8f9298 },
  { id: 'snow_white', name: 'Silver White', hex: '#e3e4eb', color: 0xe3e4eb },
];

/**
 * Hairstyles provided by the Quaternius base pack.
 */
export const HAIR_STYLE_OPTIONS: readonly HairStyleOption[] = [
  { id: 'none', name: 'Shaved', assetFile: null, allowedSex: ['female', 'male'] },
  { id: 'buzzed', name: 'Buzzed Crop', assetFile: 'hair_buzzed.glb', allowedSex: ['female', 'male'] },
  { id: 'simple_parted', name: 'Classic Parted', assetFile: 'hair_simple_parted.glb', allowedSex: ['female', 'male'] },
  { id: 'long', name: 'Long Flowing', assetFile: 'hair_long.glb', allowedSex: ['female', 'male'] },
  { id: 'buns', name: 'High Buns', assetFile: 'hair_buns.glb', allowedSex: ['female', 'male'] },
  { id: 'beard', name: 'Full Beard', assetFile: 'hair_beard.glb', allowedSex: ['male'] },
];

/**
 * Anatomical body presets adjusting proportions cleanly via skeletal scaling.
 */
export const BODY_PRESET_OPTIONS: readonly BodyPresetOption[] = [
  { id: 'lean', name: 'Lean', description: 'Slender, agile frame', scale: [0.93, 1.0, 0.92] },
  { id: 'average', name: 'Average', description: 'Balanced athletic build', scale: [1.0, 1.0, 1.0] },
  { id: 'broad', name: 'Broad', description: 'Wider shoulders and chest', scale: [1.08, 1.01, 1.06] },
  { id: 'heavy', name: 'Heavy', description: 'Stout, powerful silhouette', scale: [1.14, 0.99, 1.12] },
];

export function getDefaultCharacterConfig(sex: Sex = 'female'): CharacterConfig {
  return {
    sex,
    skinToneId: 'bronze',
    hairStyleId: sex === 'female' ? 'buns' : 'simple_parted',
    hairColorId: 'dark_brown',
    bodyPreset: 'average',
  };
}

export function sanitizeCharacterConfig(input: unknown): CharacterConfig {
  const fallback = getDefaultCharacterConfig('female');
  if (!input || typeof input !== 'object') return fallback;

  const raw = input as Record<string, unknown>;
  const sex: Sex = raw.sex === 'male' ? 'male' : 'female';

  const skinToneId = typeof raw.skinToneId === 'string' &&
    SKIN_TONE_PRESETS.some(p => p.id === raw.skinToneId)
      ? raw.skinToneId
      : fallback.skinToneId;

  const validHairStyles = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes(sex)).map(h => h.id);
  const hairStyleId: HairStyleId = typeof raw.hairStyleId === 'string' &&
    validHairStyles.includes(raw.hairStyleId as HairStyleId)
      ? (raw.hairStyleId as HairStyleId)
      : (sex === 'female' ? 'buns' : 'simple_parted');

  const hairColorId = typeof raw.hairColorId === 'string' &&
    HAIR_COLOR_PRESETS.some(h => h.id === raw.hairColorId)
      ? raw.hairColorId
      : fallback.hairColorId;

  const bodyPreset: BodyPreset = typeof raw.bodyPreset === 'string' &&
    BODY_PRESET_OPTIONS.some(b => b.id === raw.bodyPreset)
      ? (raw.bodyPreset as BodyPreset)
      : fallback.bodyPreset;

  return {
    sex,
    skinToneId,
    hairStyleId,
    hairColorId,
    bodyPreset,
  };
}

export function getStoredCharacter(): CharacterConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_CHARACTER_KEY);
    return raw ? sanitizeCharacterConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveStoredCharacter(config: CharacterConfig): void {
  // Never persist any personal data or birth dates
  const clean = sanitizeCharacterConfig(config);
  localStorage.setItem(STORAGE_CHARACTER_KEY, JSON.stringify(clean));
}

export function rollRandomCharacter(): CharacterConfig {
  const sex: Sex = Math.random() < 0.5 ? 'male' : 'female';
  const skinTone = SKIN_TONE_PRESETS[Math.floor(Math.random() * SKIN_TONE_PRESETS.length)]!;
  const availableHairs = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes(sex));
  const hairStyle = availableHairs[Math.floor(Math.random() * availableHairs.length)]!;
  const hairColor = HAIR_COLOR_PRESETS[Math.floor(Math.random() * HAIR_COLOR_PRESETS.length)]!;
  const bodyPreset = BODY_PRESET_OPTIONS[Math.floor(Math.random() * BODY_PRESET_OPTIONS.length)]!;

  return {
    sex,
    skinToneId: skinTone.id,
    hairStyleId: hairStyle.id,
    hairColorId: hairColor.id,
    bodyPreset: bodyPreset.id,
  };
}
