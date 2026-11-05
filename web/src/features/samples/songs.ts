// The built-in sample songs (APP_DESIGN.md §7.1). Every one is a public-
// domain composition, arranged and entered note by note for this project
// (no third-party MIDI file or engraving is copied), so the generated MIDI
// can ship with the app under its own licence. Notation: ./notes.ts.

export interface SampleTrack {
  /** Becomes the MIDI track name. */
  name: string;
  /** General MIDI program (0 = Acoustic Grand Piano). */
  program: number;
  velocity: number;
  /** One string per measure. */
  measures: string[];
}

export interface SampleSong {
  id: string;
  /** The project title (the file name without .mid). */
  title: string;
  composer: string;
  /** One line for the home screen. */
  note: string;
  bpm: number;
  beats: number;
  beatType: number;
  /** Key signature: sharps (+) or flats (−), and major/minor. */
  keyFifths: number;
  minor: boolean;
  /** Right hand, left hand: imported as one grand-staff piano part. */
  tracks: [SampleTrack, SampleTrack];
}

const RIGHT = { name: "右手", program: 0, velocity: 84 } as const;
const LEFT = { name: "左手", program: 0, velocity: 64 } as const;

const TWINKLE_A = ["C4:q C4:q G4:q G4:q", "A4:q A4:q G4:h", "F4:q F4:q E4:q E4:q", "D4:q D4:q C4:h"];
const TWINKLE_B = ["G4:q G4:q F4:q F4:q", "E4:q E4:q D4:h"];
const TWINKLE_A_BASS = ["C3:h E3:h", "F3:h E3:h", "D3:h C3:h", "G2:h C3:h"];
const TWINKLE_B_BASS = ["E3:h D3:h", "C3:h B2:h"];

const MINUET_RIGHT = [
  "D5:q G4:e A4:e B4:e C5:e",
  "D5:q G4:q G4:q",
  "E5:q C5:e D5:e E5:e F#5:e",
  "G5:q G4:q G4:q",
  "C5:q D5:e C5:e B4:e A4:e",
  "B4:q C5:e B4:e A4:e G4:e",
  "F#4:q G4:e A4:e B4:e G4:e",
  "A4:h.",
];
const MINUET_RIGHT_END = [
  "C5:q D5:e C5:e B4:e A4:e",
  "B4:q C5:e B4:e A4:e G4:e",
  "A4:q B4:e A4:e G4:e F#4:e",
  "G4:h.",
];

const ODE_A = ["F#4:q F#4:q G4:q A4:q", "A4:q G4:q F#4:q E4:q", "D4:q D4:q E4:q F#4:q"];
const ODE_A_BASS = ["D3:h A2:h", "D3:h A2:h", "D3:h A2:h"];

const ELISE_RIGHT = [
  "E5:s D#5:s E5:s B4:s D5:s C5:s",
  "A4:e r:s C4:s E4:s A4:s",
  "B4:e r:s E4:s G#4:s B4:s",
  "C5:e r:s E4:s E5:s D#5:s",
  "E5:s D#5:s E5:s B4:s D5:s C5:s",
  "A4:e r:s C4:s E4:s A4:s",
  "B4:e r:s E4:s C5:s B4:s",
];
const ELISE_LEFT = [
  "r:q.",
  "A2:s E3:s A3:s r:s r:e",
  "E2:s E3:s G#3:s r:s r:e",
  "A2:s E3:s A3:s r:s r:e",
  "r:q.",
  "A2:s E3:s A3:s r:s r:e",
  "E2:s E3:s G#3:s r:s r:e",
];

export const SAMPLE_SONGS: readonly SampleSong[] = [
  {
    id: "twinkle",
    title: "きらきら星",
    composer: "フランス民謡",
    note: "やさしいハ長調。まず再生を試すなら",
    bpm: 100,
    beats: 4,
    beatType: 4,
    keyFifths: 0,
    minor: false,
    tracks: [
      { ...RIGHT, measures: [...TWINKLE_A, ...TWINKLE_B, ...TWINKLE_B, ...TWINKLE_A] },
      { ...LEFT, measures: [...TWINKLE_A_BASS, ...TWINKLE_B_BASS, ...TWINKLE_B_BASS, ...TWINKLE_A_BASS] },
    ],
  },
  {
    id: "minuet",
    title: "メヌエット ト長調",
    composer: "ペツォールト（伝 J.S.バッハ）",
    note: "3/4拍子、右手と左手の2声",
    bpm: 112,
    beats: 3,
    beatType: 4,
    keyFifths: 1,
    minor: false,
    tracks: [
      { ...RIGHT, measures: [...MINUET_RIGHT, ...MINUET_RIGHT.slice(0, 4), ...MINUET_RIGHT_END] },
      {
        ...LEFT,
        measures: [
          "G3+B3+D4:h A3:q",
          "B3:h.",
          "C4:h.",
          "B3:h.",
          "A3:h.",
          "G3:h.",
          "D4:q B3:q G3:q",
          "D4:q D3:e C4:e B3:e A3:e",
          "B3:h A3:q",
          "G3:q B3:q G3:q",
          "C4:h.",
          "B3:q C4:e B3:e A3:e G3:e",
          "A3:h F#3:q",
          "G3:h B3:q",
          "C4:q D4:q D3:q",
          "G3:h G2:q",
        ],
      },
    ],
  },
  {
    id: "ode-to-joy",
    title: "歓喜の歌",
    composer: "ベートーヴェン（交響曲第9番より）",
    note: "ニ長調。付点のリズムと8分音符",
    bpm: 116,
    beats: 4,
    beatType: 4,
    keyFifths: 2,
    minor: false,
    tracks: [
      {
        ...RIGHT,
        measures: [
          ...ODE_A,
          "F#4:q. E4:e E4:h",
          ...ODE_A,
          "E4:q. D4:e D4:h",
          "E4:q E4:q F#4:q D4:q",
          "E4:q F#4:e G4:e F#4:q D4:q",
          "E4:q F#4:e G4:e F#4:q E4:q",
          "D4:q E4:q A3:h",
          ...ODE_A,
          "E4:q. D4:e D4:h",
        ],
      },
      {
        ...LEFT,
        measures: [
          ...ODE_A_BASS,
          "D3:h A2:h",
          ...ODE_A_BASS,
          "A2:h D3:h",
          "A2:h D3:h",
          "A2:h D3:h",
          "A2:h A2:h",
          "D3:h A2:h",
          ...ODE_A_BASS,
          "A2:h D3:h",
        ],
      },
    ],
  },
  {
    id: "fur-elise",
    title: "エリーゼのために",
    composer: "ベートーヴェン（冒頭）",
    note: "イ短調、3/8拍子の16分音符",
    bpm: 66,
    beats: 3,
    beatType: 8,
    keyFifths: 0,
    minor: true,
    tracks: [
      {
        ...RIGHT,
        // The upbeat is written as a full measure that starts with a rest.
        measures: ["r:q E5:s D#5:s", ...ELISE_RIGHT, "A4:e r:e E5:s D#5:s", ...ELISE_RIGHT, "A4:q."],
      },
      { ...LEFT, measures: ["r:q.", ...ELISE_LEFT, "A2:s E3:s A3:s r:s r:e", ...ELISE_LEFT, "A2:s E3:s A3:q"] },
    ],
  },
];
