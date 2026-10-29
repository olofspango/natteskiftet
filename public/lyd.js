// Lyd og musikk. Alt syntetiseres med Web Audio, så det finnes ingen lydfiler.
// Nettleseren tillater ikke lyd før første klikk/tastetrykk, derfor vekkLyd().

function lesValg(nøkkel, standard) {
  try {
    const v = localStorage.getItem(nøkkel);
    return v === null ? standard : v === '1';
  } catch {
    return standard;
  }
}

function lagreValg(nøkkel, verdi) {
  try {
    localStorage.setItem(nøkkel, verdi ? '1' : '0');
  } catch {
    // privat vindu e.l. – valget gjelder bare denne økta
  }
}

const lyd = {
  ctx: null, master: null, musikkBuss: null, effektBuss: null, støy: null,
  musikkPå: lesValg('natteskiftet.musikk', true),
  effekterPå: lesValg('natteskiftet.effekter', true),
};

function forsterker(verdi, mål) {
  const g = lyd.ctx.createGain();
  g.gain.value = verdi;
  g.connect(mål);
  return g;
}

function vekkLyd() {
  if (!lyd.ctx) {
    const Kontekst = window.AudioContext ?? window.webkitAudioContext;
    if (!Kontekst) return;
    lyd.ctx = new Kontekst();
    const kompressor = lyd.ctx.createDynamicsCompressor();
    kompressor.connect(lyd.ctx.destination);
    lyd.master = forsterker(0.8, kompressor);
    lyd.musikkBuss = forsterker(0.32, lyd.master);
    lyd.effektBuss = forsterker(0.6, lyd.master);
    lyd.støy = lagStøy();
  }
  if (lyd.ctx.state === 'suspended') lyd.ctx.resume();
  if (musikk.ønsket && !musikk.navn) spillMusikk(musikk.ønsket);
}

function lagStøy() {
  const buffer = lyd.ctx.createBuffer(1, lyd.ctx.sampleRate, lyd.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// ---------- Byggeklosser ----------

function tone({ type = 'square', frekvens, tilFrekvens, start, varighet, volum = 0.2, buss, attack = 0.005, hold = 0, detune = 0, vibrato = 0 }) {
  const ctx = lyd.ctx;
  varighet = Math.max(varighet, attack + 0.02);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frekvens, start);
  if (tilFrekvens) osc.frequency.exponentialRampToValueAtTime(tilFrekvens, start + varighet);
  osc.detune.value = detune;

  const kurve = ctx.createGain();
  kurve.gain.setValueAtTime(0.0001, start);
  kurve.gain.linearRampToValueAtTime(volum, start + attack);
  if (hold) kurve.gain.setValueAtTime(volum, start + Math.max(varighet * hold, attack));
  kurve.gain.exponentialRampToValueAtTime(0.0001, start + varighet);
  osc.connect(kurve).connect(buss);

  if (vibrato) {
    const lfo = ctx.createOscillator();
    const dybde = ctx.createGain();
    lfo.frequency.value = 5.5;
    dybde.gain.value = vibrato;
    lfo.connect(dybde).connect(osc.detune);
    lfo.start(start);
    lfo.stop(start + varighet + 0.05);
  }
  osc.start(start);
  osc.stop(start + varighet + 0.05);
}

function sus({ start, varighet, volum = 0.2, buss, filter = 'highpass', frekvens = 1000, tilFrekvens, q = 1 }) {
  const ctx = lyd.ctx;
  const kilde = ctx.createBufferSource();
  kilde.buffer = lyd.støy;
  kilde.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(frekvens, start);
  if (tilFrekvens) f.frequency.exponentialRampToValueAtTime(tilFrekvens, start + varighet);
  const kurve = ctx.createGain();
  kurve.gain.setValueAtTime(0.0001, start);
  kurve.gain.linearRampToValueAtTime(volum, start + 0.003);
  kurve.gain.exponentialRampToValueAtTime(0.0001, start + varighet);
  kilde.connect(f).connect(kurve).connect(buss);
  kilde.start(start, Math.random() * 0.5);
  kilde.stop(start + varighet + 0.05);
}

// ---------- Lydeffekter ----------

function effekt(lag) {
  if (!lyd.effekterPå || lyd.ctx?.state !== 'running') return;
  lag(lyd.ctx.currentTime, lyd.effektBuss);
}

const lyder = {
  blipp: (klasse = '') => effekt((t, b) => tone({
    type: klasse === 'tanke' ? 'triangle' : 'square',
    frekvens: klasse === 'tanke' ? 330 : klasse === 'fare' ? 220 : 660,
    start: t, varighet: 0.03, volum: 0.05, buss: b,
  })),
  hover: () => effekt((t, b) => tone({ frekvens: 1200, start: t, varighet: 0.025, volum: 0.03, buss: b })),
  velg: () => effekt((t, b) => {
    tone({ frekvens: 523, start: t, varighet: 0.07, volum: 0.08, buss: b });
    tone({ frekvens: 784, start: t + 0.07, varighet: 0.12, volum: 0.08, buss: b });
  }),
  start: () => effekt((t, b) => [440, 523, 659, 831].forEach((f, i) =>
    tone({ type: 'triangle', frekvens: f, start: t + i * 0.08, varighet: 0.5, volum: 0.14, buss: b }))),
  // Støy som stiger, så en skjærende klynge (E, F og B♭ samtidig)
  møte: () => effekt((t, b) => {
    sus({ start: t, varighet: 0.7, volum: 0.25, buss: b, filter: 'bandpass', frekvens: 200, tilFrekvens: 5000, q: 2 });
    for (const f of [164.8, 174.6, 233.1]) tone({ type: 'sawtooth', frekvens: f, start: t + 0.7, varighet: 0.7, volum: 0.08, buss: b, hold: 0.3 });
  }),
  kall: () => effekt((t, b) => {
    sus({ start: t, varighet: 0.22, volum: 0.2, buss: b, filter: 'bandpass', frekvens: 600, tilFrekvens: 3500, q: 3 });
    tone({ frekvens: 880, tilFrekvens: 1320, start: t + 0.05, varighet: 0.09, volum: 0.06, buss: b });
  }),
  treff: () => effekt((t, b) => {
    sus({ start: t, varighet: 0.1, volum: 0.35, buss: b, filter: 'lowpass', frekvens: 2500 });
    tone({ frekvens: 600, tilFrekvens: 150, start: t, varighet: 0.16, volum: 0.12, buss: b });
  }),
  bom: () => effekt((t, b) => {
    tone({ type: 'sawtooth', frekvens: 70, start: t, varighet: 0.45, volum: 0.16, buss: b, hold: 0.5 });
    tone({ type: 'sawtooth', frekvens: 73.5, start: t, varighet: 0.45, volum: 0.16, buss: b, hold: 0.5 });
    sus({ start: t, varighet: 0.2, volum: 0.15, buss: b, filter: 'lowpass', frekvens: 400 });
  }),
  tikk: () => effekt((t, b) => {
    sus({ start: t, varighet: 0.025, volum: 0.25, buss: b, frekvens: 4000 });
    sus({ start: t + 0.18, varighet: 0.025, volum: 0.18, buss: b, frekvens: 2500 });
  }),
  hjerteslag: () => effekt((t, b) => {
    for (const [d, v] of [[0, 0.5], [0.22, 0.35]]) tone({ type: 'sine', frekvens: 70, tilFrekvens: 35, start: t + d, varighet: 0.2, volum: v, buss: b });
  }),
  besvim: () => effekt((t, b) => {
    tone({ frekvens: 900, tilFrekvens: 50, start: t, varighet: 1.2, volum: 0.12, buss: b, vibrato: 60, hold: 0.6 });
    sus({ start: t, varighet: 1.2, volum: 0.12, buss: b, filter: 'lowpass', frekvens: 3000, tilFrekvens: 100 });
  }),
  // Gammeldags telefonringing: to korte triller
  ring: () => effekt((t, b) => {
    for (let i = 0; i < 16; i++) {
      const start = t + i * 0.05 + (i >= 8 ? 0.2 : 0);
      tone({ type: 'square', frekvens: i % 2 ? 1300 : 1050, start, varighet: 0.045, volum: 0.05, buss: b });
    }
  }),
  skrik: () => effekt((t, b) => {
    for (const f of [1400, 1480, 1975]) tone({ type: 'sawtooth', frekvens: f, tilFrekvens: f / 4, start: t, varighet: 0.8, volum: 0.05, buss: b, vibrato: 80, hold: 0.3 });
    sus({ start: t, varighet: 0.5, volum: 0.2, buss: b, frekvens: 2000 });
  }),
};

// ---------- Musikk ----------

const NOTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(note) {
  if (/^\d+$/.test(note)) return Number(note);
  const m = note.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) throw new Error(`Ukjent note «${note}»`);
  return 12 * (Number(m[3]) + 1) + NOTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const tilHz = (m) => 440 * 2 ** ((m - 69) / 12);

// Et spor er en streng med ett tegn per steg: note, «-» holder forrige, «.» er pause.
// strekk 2 gjør hver tone dobbelt så lang (åttendedeler i et sekstendedels-spor).
function lesSpor({ noter, strekk = 1, trommer = false, ...resten }) {
  const tegnene = noter.split(/\s+/).filter((t) => t && t !== '|')
    .flatMap((t) => [t, ...Array(strekk - 1).fill(t === '.' ? '.' : '-')]);
  const hendelser = new Map();
  let siste = null;
  tegnene.forEach((t, i) => {
    if (t === '-') {
      if (siste) siste.lengde++;
    } else if (t === '.') {
      siste = null;
    } else {
      siste = { verdi: trommer ? t : midi(t), lengde: 1 };
      hendelser.set(i, siste);
    }
  });
  return { ...resten, trommer, hendelser, lengde: tegnene.length };
}

const INSTRUMENTER = {
  // En spilledåse som har stått for lenge på loftet: litt ustemt.
  spilledåse: (t, hz, l, v, b, steg) => {
    const detune = Math.sin(steg * 1.7) * 14;
    tone({ type: 'sine', frekvens: hz, start: t, varighet: 1.6, volum: v, buss: b, detune });
    tone({ type: 'sine', frekvens: hz * 2.005, start: t, varighet: 0.35, volum: v * 0.35, buss: b, detune });
  },
  pust: (t, hz, l, v, b) => tone({ type: 'sine', frekvens: hz, start: t, varighet: 0.5, volum: v, buss: b, attack: 0.03 }),
  drone: (t, hz, l, v, b) => {
    tone({ type: 'triangle', frekvens: hz, start: t, varighet: l, volum: v, buss: b, attack: 0.2, hold: 0.8 });
    tone({ type: 'sawtooth', frekvens: hz * 1.004, start: t, varighet: l, volum: v * 0.12, buss: b, attack: 0.2, hold: 0.8 });
  },
  lead: (t, hz, l, v, b) => tone({ type: 'square', frekvens: hz, start: t, varighet: l * 0.92, volum: v, buss: b, hold: 0.7, vibrato: l > 0.3 ? 14 : 0 }),
  bass: (t, hz, l, v, b) => tone({ type: 'triangle', frekvens: hz, start: t, varighet: l * 0.8, volum: v, buss: b, hold: 0.6 }),
  arp: (t, hz, l, v, b) => tone({ type: 'square', frekvens: hz, start: t, varighet: l * 0.6, volum: v, buss: b }),
};

const TROMMER = {
  k: (t, b, v) => tone({ type: 'sine', frekvens: 150, tilFrekvens: 40, start: t, varighet: 0.16, volum: v * 1.6, buss: b }),
  s: (t, b, v) => {
    sus({ start: t, varighet: 0.12, volum: v * 0.7, buss: b, frekvens: 1800 });
    tone({ type: 'triangle', frekvens: 190, tilFrekvens: 120, start: t, varighet: 0.08, volum: v * 0.6, buss: b });
  },
  h: (t, b, v) => sus({ start: t, varighet: 0.035, volum: v * 0.35, buss: b, frekvens: 7500 }),
};

const sprett = (rot) => Array(4).fill(`${midi(rot)} ${midi(rot) + 12}`).join(' ');
const arpeggio = (akkord) => Array(4).fill([...akkord, akkord[0] + 12].join(' ')).join(' ');
const TROMMETAKT = 'kh . h . sh . h . kh . kh . sh . h h';
const TROMMEFILL = 'kh . h . sh . sh . s s s s s s s s';

const SANGER = {
  // Tittel og alarmvalg: en vals i a-moll fra en spilledåse, med vind under.
  natt: {
    bpm: 92, steg: 2, løkke: true, vind: true,
    spor: [
      { instrument: 'spilledåse', volum: 0.22, noter:
        'A4 - C5 - E5 - | D#5 - E5 - B4 - | C5 - B4 - A4 - | G#4 - - - - - | ' +
        'A4 - C5 - E5 - | F5 - E5 - D5 - | C5 - B4 - G#4 - | A4 - - - . .' },
      { instrument: 'drone', volum: 0.16, noter:
        'A2 - - - - - | E2 - - - - - | F2 - - - - - | E2 - - - - - | ' +
        'A2 - - - - - | D2 - - - - - | E2 - - - - - | A2 - - - - -' },
      { instrument: 'pust', volum: 0.07, noter:
        '. . C4 . E4 . | . . G#3 . B3 . | . . A3 . C4 . | . . G#3 . D4 . | ' +
        '. . C4 . E4 . | . . F3 . A3 . | . . G#3 . B3 . | . . C4 . E4 .' },
    ],
  },
  // Kampen: e-moll med frygisk F og en tritonus, 152 bpm.
  kamp: {
    bpm: 152, steg: 4, løkke: true,
    spor: [
      { instrument: 'lead', volum: 0.12, strekk: 2, noter:
        'E5 - G5 F#5 E5 - B4 - | C5 - B4 A4 B4 - - - | E5 - G5 F#5 E5 - A#4 - | B4 - - - . . . . | ' +
        'G5 - A5 B5 C6 - B5 A5 | B5 - G5 - F#5 - E5 - | F5 - E5 D#5 E5 - G5 - | F#5 - - - D#5 - - -' },
      { instrument: 'bass', volum: 0.22, strekk: 2, noter:
        ['E2', 'C2', 'E2', 'B1', 'C2', 'E2', 'F2', 'B1'].map(sprett).join(' | ') },
      { trommer: true, volum: 0.3, noter: [...Array(7).fill(TROMMETAKT), TROMMEFILL].join(' | ') },
      // Bare når uvissheten er lav: alt går fortere i hodet.
      { instrument: 'arp', volum: 0.04, spenning: true, noter:
        [[64, 67, 71], [60, 64, 67], [64, 67, 71], [59, 63, 66], [60, 64, 67], [64, 67, 71], [65, 69, 72], [59, 63, 66]].map(arpeggio).join(' | ') },
    ],
  },
  seier: {
    bpm: 140, steg: 2, løkke: false,
    spor: [
      { instrument: 'lead', volum: 0.13, noter: 'B4 E5 G#5 B5 | E6 - - D#6 | E6 - - - - - - - | . . . .' },
      { instrument: 'bass', volum: 0.22, noter: 'E3 - - - | B2 - - - | E2 - - - - - - - | . . . .' },
      { trommer: true, volum: 0.3, noter: 'k . . . | k . . . | ks . . . . . . . | . . . .' },
    ],
  },
  tap: {
    bpm: 66, steg: 2, løkke: false,
    spor: [
      { instrument: 'lead', volum: 0.1, noter: 'E5 D#5 D5 C#5 | C5 - - - - - | . . . .' },
      { instrument: 'drone', volum: 0.2, noter: 'E2 - - - | A#1 - - - - - | . . . .' },
    ],
  },
};

const musikk = { ønsket: 'natt', navn: null, sang: null, steg: 0, neste: 0, timer: null, utgang: null, vind: null, spenning: false };
const kompilert = new Map();

function hentSang(navn) {
  if (!kompilert.has(navn)) {
    const sang = SANGER[navn];
    const spor = sang.spor.map(lesSpor);
    kompilert.set(navn, { ...sang, spor, lengde: Math.max(...spor.map((s) => s.lengde)) });
  }
  return kompilert.get(navn);
}

// navn = null stopper musikken.
function spillMusikk(navn) {
  musikk.ønsket = navn;
  if (musikk.navn === navn) return;
  stoppMusikk();
  if (!navn || !lyd.musikkPå || !lyd.ctx) return;
  musikk.navn = navn;
  musikk.sang = hentSang(navn);
  musikk.steg = 0;
  musikk.neste = lyd.ctx.currentTime + 0.08;
  musikk.utgang = forsterker(1, lyd.musikkBuss);
  if (musikk.sang.vind) musikk.vind = startVind(musikk.utgang);
  musikk.timer = setInterval(planlegg, 25);
  planlegg();
}

function stoppMusikk() {
  clearInterval(musikk.timer);
  if (musikk.utgang) {
    const g = musikk.utgang;
    const t = lyd.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    musikk.vind?.stopp(t + 0.5);
    setTimeout(() => g.disconnect(), 700);
  }
  Object.assign(musikk, { navn: null, sang: null, timer: null, utgang: null, vind: null });
}

// Planlegger tonene litt fram i tid, så setInterval-hikke ikke høres.
function planlegg() {
  const { sang } = musikk;
  const nå = lyd.ctx.currentTime;
  const sekPerSteg = 60 / sang.bpm / sang.steg;
  if (musikk.neste < nå - 0.1) musikk.neste = nå + 0.05; // fanen var i bakgrunnen
  while (musikk.neste < nå + 0.15) {
    if (!sang.løkke && musikk.steg >= sang.lengde) {
      stoppMusikk();
      musikk.ønsket = null;
      return;
    }
    spillSteg(musikk.steg, musikk.neste, sekPerSteg);
    musikk.neste += sekPerSteg;
    musikk.steg++;
  }
}

function spillSteg(steg, t, sekPerSteg) {
  for (const spor of musikk.sang.spor) {
    if (spor.spenning && !musikk.spenning) continue;
    const h = spor.hendelser.get(steg % spor.lengde);
    if (!h) continue;
    if (spor.trommer) {
      for (const slag of h.verdi) TROMMER[slag]?.(t, musikk.utgang, spor.volum);
    } else {
      INSTRUMENTER[spor.instrument](t, tilHz(h.verdi), h.lengde * sekPerSteg, spor.volum, musikk.utgang, steg);
    }
  }
}

function startVind(buss) {
  const ctx = lyd.ctx;
  const kilde = ctx.createBufferSource();
  kilde.buffer = lyd.støy;
  kilde.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 500;
  f.Q.value = 0.8;
  const lfo = ctx.createOscillator();
  const dybde = ctx.createGain();
  lfo.frequency.value = 0.08;
  dybde.gain.value = 300;
  lfo.connect(dybde).connect(f.frequency);
  kilde.connect(f).connect(forsterker(0.18, buss));
  kilde.start();
  lfo.start();
  return { stopp: (t) => { kilde.stop(t); lfo.stop(t); } };
}

function settSpenning(på) {
  musikk.spenning = på;
}

// ---------- Knappene ----------

function initLyd() {
  const musikkKnapp = document.getElementById('musikk');
  const effektKnapp = document.getElementById('effekter');
  const vis = () => {
    musikkKnapp.textContent = lyd.musikkPå ? '🎵 MUSIKK PÅ' : '🎵 MUSIKK AV';
    musikkKnapp.setAttribute('aria-pressed', String(lyd.musikkPå));
    effektKnapp.textContent = lyd.effekterPå ? '🔊 EFFEKTER PÅ' : '🔇 EFFEKTER AV';
    effektKnapp.setAttribute('aria-pressed', String(lyd.effekterPå));
  };

  musikkKnapp.addEventListener('click', () => {
    lyd.musikkPå = !lyd.musikkPå;
    lagreValg('natteskiftet.musikk', lyd.musikkPå);
    const ønsket = musikk.ønsket;
    stoppMusikk();
    if (lyd.musikkPå) spillMusikk(ønsket);
    vis();
  });
  effektKnapp.addEventListener('click', () => {
    lyd.effekterPå = !lyd.effekterPå;
    lagreValg('natteskiftet.effekter', lyd.effekterPå);
    lyder.velg();
    vis();
  });

  for (const hendelse of ['pointerdown', 'keydown']) document.addEventListener(hendelse, vekkLyd);
  vis();
}
