// How each GM percussion key is written on a five-line drum staff: kick in
// the bottom space, snare on the third space, cymbals above with x heads.
export interface DrumNotation {
  Name: string;
  Step: string;
  Octave: number;
  Notehead: string;
  Foot: boolean;
}

const GM_DRUMS: Record<number, DrumNotation> = {
  35: { Name: "Acoustic Bass Drum", Step: "E", Octave: 4, Notehead: "", Foot: true },
  36: { Name: "Bass Drum", Step: "F", Octave: 4, Notehead: "", Foot: true },
  37: { Name: "Side Stick", Step: "C", Octave: 5, Notehead: "circle-x", Foot: false },
  38: { Name: "Acoustic Snare", Step: "C", Octave: 5, Notehead: "", Foot: false },
  39: { Name: "Hand Clap", Step: "C", Octave: 5, Notehead: "x", Foot: false },
  40: { Name: "Electric Snare", Step: "C", Octave: 5, Notehead: "", Foot: false },
  41: { Name: "Low Floor Tom", Step: "G", Octave: 4, Notehead: "", Foot: false },
  42: { Name: "Closed Hi-Hat", Step: "G", Octave: 5, Notehead: "x", Foot: false },
  43: { Name: "High Floor Tom", Step: "A", Octave: 4, Notehead: "", Foot: false },
  44: { Name: "Pedal Hi-Hat", Step: "D", Octave: 4, Notehead: "x", Foot: true },
  45: { Name: "Low Tom", Step: "B", Octave: 4, Notehead: "", Foot: false },
  46: { Name: "Open Hi-Hat", Step: "G", Octave: 5, Notehead: "circle-x", Foot: false },
  47: { Name: "Low-Mid Tom", Step: "D", Octave: 5, Notehead: "", Foot: false },
  48: { Name: "Hi-Mid Tom", Step: "E", Octave: 5, Notehead: "", Foot: false },
  49: { Name: "Crash Cymbal 1", Step: "A", Octave: 5, Notehead: "x", Foot: false },
  50: { Name: "High Tom", Step: "F", Octave: 5, Notehead: "", Foot: false },
  51: { Name: "Ride Cymbal 1", Step: "F", Octave: 5, Notehead: "x", Foot: false },
  52: { Name: "Chinese Cymbal", Step: "B", Octave: 5, Notehead: "x", Foot: false },
  53: { Name: "Ride Bell", Step: "F", Octave: 5, Notehead: "diamond", Foot: false },
  54: { Name: "Tambourine", Step: "E", Octave: 5, Notehead: "x", Foot: false },
  55: { Name: "Splash Cymbal", Step: "B", Octave: 5, Notehead: "x", Foot: false },
  56: { Name: "Cowbell", Step: "E", Octave: 5, Notehead: "triangle", Foot: false },
  57: { Name: "Crash Cymbal 2", Step: "B", Octave: 5, Notehead: "x", Foot: false },
  59: { Name: "Ride Cymbal 2", Step: "D", Octave: 5, Notehead: "x", Foot: false },
};

/** Keys without a drum-set convention go on the middle line with an x. */
export function gmDrum(midiNote: number): DrumNotation {
  return GM_DRUMS[midiNote] ?? { Name: `Percussion ${midiNote}`, Step: "B", Octave: 4, Notehead: "x", Foot: false };
}
