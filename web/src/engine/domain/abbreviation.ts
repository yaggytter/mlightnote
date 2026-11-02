// Standard score abbreviations for systems after the first. Longer phrases
// come first so "Bass Clarinet" wins over "Clarinet" and "Bass".
const ABBREVIATIONS: [string, string][] = [
  ["english horn", "E.H."],
  ["french horn", "Hn."],
  ["bass clarinet", "B.Cl."],
  ["double bass", "Cb."],
  ["soprano sax", "S.Sax."],
  ["alto sax", "A.Sax."],
  ["tenor sax", "T.Sax."],
  ["baritone sax", "Bar.Sax."],
  ["electric piano", "E.Pno."],
  ["electric grand piano", "E.Pno."],
  ["grand piano", "Pno."],
  ["distortion guitar", "Dist.Gtr."],
  ["overdriven guitar", "OD.Gtr."],
  ["electric guitar", "E.Gtr."],
  ["acoustic guitar", "A.Gtr."],
  ["electric bass", "E.Bass"],
  ["acoustic bass", "A.Bass"],
  ["synth bass", "Syn.Bass"],
  ["fretless bass", "Fl.Bass"],
  ["slap bass", "Slap Bass"],
  ["string ensemble", "Str."],
  ["synth strings", "Syn.Str."],
  ["choir aahs", "Cho."],
  ["voice oohs", "Vo."],
  ["steel drums", "St.Dr."],
  ["orchestral harp", "Hp."],
  ["piccolo", "Picc."],
  ["flute", "Fl."],
  ["oboe", "Ob."],
  ["clarinet", "Cl."],
  ["bassoon", "Bsn."],
  ["contrabassoon", "Cbsn."],
  ["saxophone", "Sax."],
  ["trumpet", "Tpt."],
  ["cornet", "Cor."],
  ["horn", "Hn."],
  ["trombone", "Tbn."],
  ["euphonium", "Euph."],
  ["tuba", "Tba."],
  ["violin", "Vln."],
  ["viola", "Vla."],
  ["violoncello", "Vc."],
  ["cello", "Vc."],
  ["contrabass", "Cb."],
  ["piano", "Pno."],
  ["organ", "Org."],
  ["harpsichord", "Hpd."],
  ["celesta", "Cel."],
  ["harp", "Hp."],
  ["guitar", "Gtr."],
  ["bass", "Bass"],
  ["timpani", "Timp."],
  ["marimba", "Mar."],
  ["xylophone", "Xyl."],
  ["vibraphone", "Vib."],
  ["glockenspiel", "Glk."],
  ["harmonica", "Harm."],
  ["accordion", "Acc."],
  ["drums", "Dr."],
  ["drum", "Dr."],
  ["percussion", "Perc."],
  ["voice", "Vo."],
  ["vocal", "Vo."],
  ["soprano", "S."],
  ["alto", "A."],
  ["tenor", "T."],
  ["baritone", "Bar."],
  ["choir", "Cho."],
  ["strings", "Str."],
  ["synth", "Syn."],
  ["ピッコロ", "Picc."],
  ["フルート", "Fl."],
  ["オーボエ", "Ob."],
  ["バスクラリネット", "B.Cl."],
  ["クラリネット", "Cl."],
  ["ファゴット", "Fg."],
  ["アルトサックス", "A.Sax."],
  ["テナーサックス", "T.Sax."],
  ["バリトンサックス", "Bar.Sax."],
  ["サックス", "Sax."],
  ["トランペット", "Tpt."],
  ["ホルン", "Hn."],
  ["トロンボーン", "Tbn."],
  ["ユーフォニアム", "Euph."],
  ["チューバ", "Tba."],
  ["ヴァイオリン", "Vln."],
  ["バイオリン", "Vln."],
  ["ヴィオラ", "Vla."],
  ["ビオラ", "Vla."],
  ["チェロ", "Vc."],
  ["コントラバス", "Cb."],
  ["エレキベース", "E.Bass"],
  ["エレキギター", "E.Gtr."],
  ["ギター", "Gtr."],
  ["ベース", "Bass"],
  ["ピアノ", "Pno."],
  ["オルガン", "Org."],
  ["ドラム", "Dr."],
  ["パーカッション", "Perc."],
  ["ボーカル", "Vo."],
  ["歌", "Vo."],
  ["ティンパニ", "Timp."],
];

const PARENTHESISED = /\s*[(（][^)）]*[)）]/g;
const TRAILING_NUMBER = /\s+(\d+)$/;
const KEY_QUALIFIER = /\s+in\s+([A-G][♭♯b#]?)/i;
const MAX_FALLBACK_RUNES = 5;

/**
 * A short part label from a part name, used when the source gave none:
 * "Clarinet in B♭" → "Cl. in B♭", "Distortion Guitar 2" → "Dist.Gtr. 2",
 * "ドラム" → "Dr.". Unknown names are shortened to their first letters.
 */
export function autoAbbreviation(name: string): string {
  let base = name.replace(PARENTHESISED, "").trim();
  if (!base) return "";
  let num = "";
  const n = TRAILING_NUMBER.exec(base);
  if (n) {
    num = " " + n[1];
    base = base.slice(0, base.length - n[0].length).trim();
  }
  let key = "";
  const k = KEY_QUALIFIER.exec(base);
  if (k) {
    key = " in " + k[1];
    base = base.replace(k[0], "").trim();
  }
  const lower = base.toLowerCase();
  for (const [phrase, abbr] of ABBREVIATIONS) {
    if (lower.includes(phrase)) return abbr + key + num;
  }
  const runes = [...base];
  if (runes.length <= MAX_FALLBACK_RUNES) return base + key + num;
  return runes.slice(0, MAX_FALLBACK_RUNES - 1).join("") + "." + key + num;
}
