// Transposing-instrument presets for the part inspector. Each is MusicXML's
// <transpose>: the interval from written to sounding pitch (a B♭ clarinet
// sounds a major second lower than written: diatonic -1, chromatic -2).

export interface Transpose {
  diatonic: number;
  chromatic: number;
  octaveChange: number;
}

export interface TranspositionPreset {
  id: string;
  label: string;
  transpose: Transpose;
}

const t = (diatonic: number, chromatic: number, octaveChange = 0): Transpose => ({ diatonic, chromatic, octaveChange });

export const TRANSPOSITION_PRESETS: TranspositionPreset[] = [
  { id: "C", label: "なし（実音で記譜）", transpose: t(0, 0) },
  { id: "Bb", label: "B♭（クラリネット・トランペット・ソプラノサックス）", transpose: t(-1, -2) },
  { id: "Bb8vb", label: "B♭・1オクターブ下（テナーサックス・バスクラリネット）", transpose: t(-1, -2, -1) },
  { id: "A", label: "A（A管クラリネット）", transpose: t(-2, -3) },
  { id: "Eb", label: "E♭（アルトサックス）", transpose: t(-5, -9) },
  { id: "Eb8vb", label: "E♭・1オクターブ下（バリトンサックス）", transpose: t(-5, -9, -1) },
  { id: "EbHigh", label: "E♭・高音（E♭クラリネット）", transpose: t(2, 3) },
  { id: "F", label: "F（ホルン・イングリッシュホルン）", transpose: t(-4, -7) },
  { id: "G", label: "G（アルトフルート）", transpose: t(-3, -5) },
  { id: "D", label: "D（D管トランペット）", transpose: t(1, 2) },
  { id: "8vb", label: "1オクターブ上に記譜（ギター・ベース・コントラバス）", transpose: t(0, 0, -1) },
  { id: "8va", label: "1オクターブ下に記譜（ピッコロ）", transpose: t(0, 0, 1) },
];

export const CUSTOM_TRANSPOSITION = "custom";

export function sameTranspose(a: Transpose, b: Transpose): boolean {
  return a.diatonic === b.diatonic && a.chromatic === b.chromatic && a.octaveChange === b.octaveChange;
}

/** The preset matching a transposition, or "custom" (e.g. from a file). */
export function presetIdFor(transpose: Transpose): string {
  return TRANSPOSITION_PRESETS.find((p) => sameTranspose(p.transpose, transpose))?.id ?? CUSTOM_TRANSPOSITION;
}

export function presetById(id: string): TranspositionPreset | undefined {
  return TRANSPOSITION_PRESETS.find((p) => p.id === id);
}

// What players of these GM programs usually read. Only a suggestion: a
// "Clarinet" sound could be a B♭ or an A clarinet part.
const BY_PROGRAM: Record<number, string> = {
  56: "Bb", // Trumpet
  59: "Bb", // Muted Trumpet
  60: "F", // French Horn
  64: "Bb", // Soprano Sax
  65: "Eb", // Alto Sax
  66: "Bb8vb", // Tenor Sax
  67: "Eb8vb", // Baritone Sax
  69: "F", // English Horn
  71: "Bb", // Clarinet
  72: "8va", // Piccolo
  43: "8vb", // Contrabass
};

/** The usual transposition for a GM program (0-based), if any. */
export function suggestedPreset(program: number): TranspositionPreset | undefined {
  const guitarOrBass = program >= 24 && program <= 39;
  return presetById(BY_PROGRAM[program] ?? (guitarOrBass ? "8vb" : ""));
}
