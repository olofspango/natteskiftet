// Webgrensesnittet: agentløkka som en kamp mot alarmen. Hendelsene kommer fra
// /api/kjor (Server-Sent Events, se src/server.js og src/agent.js).
const $ = (sel) => document.querySelector(sel);
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const roligBevegelse = matchMedia('(prefers-reduced-motion: reduce)');

const NAVN = {
  betaling: 'BETALINGSGAST',
  innlogging: 'INNLOGGINGSMARE',
  sok: 'SØKEDRAUG',
  varsling: 'VARSELVETTE',
  'api-gateway': 'PORTGJENGER',
  'kunde-db': 'DATADAUDING',
};
const TYPER = { kritisk: 'BLOD', høy: 'SKYGGE', advarsel: 'TÅKE' };
const ANGREPSTYPER = {
  sok_i_logger: 'SPOR',
  hent_runbook: 'RITUAL',
  sjekk_deploy_historikk: 'FORTID',
  finn_lignende_hendelser: 'MINNE',
};
const TREFFLINJER = ['Det var supereffektivt!', 'Et spor lyser opp i mørket!', 'Uvissheten vrir seg!', 'Noe faller på plass.'];

let kamp = null;
let kampNr = 0;

// ---------- Små hjelpere ----------

function kort(tekst, maks) {
  const t = String(tekst).replace(/\s+/g, ' ').trim();
  return t.length > maks ? t.slice(0, maks - 1) + '…' : t;
}

function lag(tag, klasse, tekst) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (tekst !== undefined) el.textContent = tekst;
  return el;
}

const angrepsnavn = (navn) => navn.toUpperCase().replace(/_/g, ' ');

function hash(tekst) {
  let h = 2166136261;
  for (const c of tekst) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

function tilfeldig(frø) {
  let a = frø;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Pikselkunst ----------

const PALETTER = {
  BLOD: { 1: '#b3203a', 2: '#6e1022', 3: '#fff4a3', 4: '#1a0508', 5: '#e0556b', 9: '#12040a' },
  SKYGGE: { 1: '#6b4fa8', 2: '#3d2a6b', 3: '#b6ff5c', 4: '#120a20', 5: '#9b82d4', 9: '#0b0614' },
  TÅKE: { 1: '#8fae94', 2: '#5a7562', 3: '#ff3b4e', 4: '#142018', 5: '#c9dccb', 9: '#070d09' },
};

// Et symmetrisk gjenferd, alltid likt for samme frø.
function lagFiendeRutenett(frø) {
  const r = tilfeldig(hash(frø));
  const N = 16;
  const g = Array.from({ length: N }, () => Array(N).fill(0));
  const sett = (y, x, v) => { g[y][x] = v; g[y][N - 1 - x] = v; };

  const bredde = 5 + r() * 2;
  for (let y = 1; y < 12; y++) {
    for (let x = 1; x < 8; x++) {
      const dx = (7.5 - x) / bredde;
      const dy = (y - 6.5) / 5.5;
      const d = dx * dx + dy * dy * (y < 6 ? 1 : 0.55);
      if (d < 0.5 || (d < 1 && r() < 0.65)) sett(y, x, y > 8 ? 2 : 1);
    }
  }
  for (let y = 2; y < 12; y++) sett(y, 7, y > 8 ? 2 : 1);

  // Fliker nederst
  for (let x = 1; x < 8; x++) {
    if (g[11][x] && r() < 0.6) {
      const lengde = 1 + Math.floor(r() * 3);
      for (let y = 12; y < 12 + lengde && y < N - 1; y++) sett(y, x, 2);
    }
  }

  const øyeY = 4 + Math.floor(r() * 3);
  const øyeX = 4 + Math.floor(r() * 3);
  sett(øyeY, øyeX, 3);
  if (r() < 0.5) sett(øyeY + 1, øyeX, 3);
  if (r() < 0.75) for (let x = 5; x < 8; x++) if (g[øyeY + 3][x]) sett(øyeY + 3, x, 4);

  // Lys der det ikke er noe over
  for (let y = 1; y < N; y++) for (let x = 1; x < 8; x++) {
    if (g[y][x] === 1 && !g[y - 1][x] && x < 6) sett(y, x, 5);
  }
  return medKant(g, 9);
}

function medKant(g, kant) {
  const N = g.length;
  const ut = g.map((rad) => [...rad]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x]) continue;
    const naboer = [g[y - 1]?.[x], g[y + 1]?.[x], g[y][x - 1], g[y][x + 1]];
    if (naboer.some(Boolean)) ut[y][x] = kant;
  }
  return ut;
}

// NATTEVAKT sett bakfra, med lykt.
const SPILLER = [
  '.....kkkkk......',
  '....khcccck.....',
  '...khcccccdk....',
  '...kccccccdk....',
  '...kccccccdk....',
  '..khcccccddk....',
  '..kccccccddk....',
  '.khccccccddk.kk.',
  '.kcccccccdddkfk.',
  '.kcccccccddkfglf',
  'kccccccccddkflgf',
  'kccccccccddkfllf',
  'kcccccccddddkff.',
  'kccccccccdddk...',
  'kdcdcdcdcdck....',
  '.k.k.k.k.k.k....',
];
const SPILLERFARGER = { k: '#0a0710', c: '#3b2f5c', d: '#251c3d', h: '#5a4a86', f: '#6b5a3a', l: '#ffd36b', g: '#fff3c4' };

function tegn(lerret, rutenett, farger) {
  const ctx = lerret.getContext('2d');
  lerret.width = rutenett[0].length;
  lerret.height = rutenett.length;
  ctx.clearRect(0, 0, lerret.width, lerret.height);
  rutenett.forEach((rad, y) => [...rad].forEach((v, x) => {
    const farge = farger[v];
    if (!farge) return;
    ctx.fillStyle = farge;
    ctx.fillRect(x, y, 1, 1);
  }));
}

// ---------- Lyd (av som standard) ----------

const lyd = { på: false, ctx: null };

function tone(frekvens, varighet = 0.08, forsinkelse = 0, type = 'square', volum = 0.03) {
  if (!lyd.på) return;
  lyd.ctx ??= new AudioContext();
  const t = lyd.ctx.currentTime + forsinkelse;
  const osc = lyd.ctx.createOscillator();
  const gain = lyd.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frekvens, t);
  gain.gain.setValueAtTime(volum, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + varighet);
  osc.connect(gain).connect(lyd.ctx.destination);
  osc.start(t);
  osc.stop(t + varighet);
}

const lyder = {
  blipp: () => tone(660, 0.025, 0, 'square', 0.015),
  møte: () => [220, 207, 196, 185].forEach((f, i) => tone(f, 0.18, i * 0.16, 'sawtooth')),
  treff: () => { tone(330, 0.06); tone(494, 0.1, 0.06); },
  bom: () => tone(90, 0.3, 0, 'sawtooth', 0.05),
  seier: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 0.2, i * 0.14)),
  tap: () => [330, 311, 294, 220].forEach((f, i) => tone(f, 0.3, i * 0.22, 'triangle', 0.05)),
};

function byttLyd() {
  lyd.på = !lyd.på;
  const knapp = $('#lyd');
  knapp.textContent = lyd.på ? '🔊 LYD PÅ' : '🔇 LYD AV';
  knapp.setAttribute('aria-pressed', String(lyd.på));
  if (lyd.på) lyder.treff();
}

// ---------- Dialogboksen ----------

const dialog = { kø: [], aktiv: false, ventere: [] };

function si(tekst, klasse = '') {
  dialog.kø.push({ tekst, klasse, nr: kampNr });
  if (!dialog.aktiv) spillDialog();
}

async function spillDialog() {
  dialog.aktiv = true;
  const boks = $('#dialog-tekst');
  const pil = $('#dialog-pil');
  while (dialog.kø.length) {
    const { tekst, klasse, nr } = dialog.kø.shift();
    if (nr !== kampNr) continue;
    boks.className = 'dialog-tekst ' + klasse;
    $('#dialog-sr').textContent = tekst;
    pil.hidden = true;
    // Ligger vi langt bak hendelsene, skriver vi fortere.
    const fart = roligBevegelse.matches || dialog.kø.length > 4 ? 0 : dialog.kø.length > 1 ? 8 : 22;
    if (fart === 0) {
      boks.textContent = tekst;
    } else {
      boks.textContent = '';
      const tegnene = [...tekst];
      for (let i = 0; i < tegnene.length && nr === kampNr; i++) {
        boks.textContent += tegnene[i];
        if (i % 3 === 0) lyder.blipp();
        await vent(fart);
      }
    }
    pil.hidden = false;
    await vent(dialog.kø.length > 2 ? 200 : 650);
  }
  dialog.aktiv = false;
  dialog.ventere.splice(0).forEach((f) => f());
}

const stille = () => (dialog.aktiv ? new Promise((r) => dialog.ventere.push(r)) : Promise.resolve());

// ---------- Skjermer ----------

function visSkjerm(id) {
  for (const s of document.querySelectorAll('.skjerm')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function lagTittel() {
  const h1 = $('.drypp');
  const bokstaver = [...h1.textContent];
  h1.textContent = '';
  bokstaver.forEach((b, i) => {
    const span = lag('span', '', b);
    span.setAttribute('aria-hidden', 'true');
    const r = tilfeldig(i + 7);
    if (r() < 0.55) {
      span.style.setProperty('--d', `${0.2 + r() * 0.7}em`);
      span.style.setProperty('--x', `${20 + r() * 50}%`);
      span.style.setProperty('--f', `${r() * 3}s`);
    }
    h1.append(span);
  });
}

async function visVelg() {
  visSkjerm('velg');
  const liste = $('#alarmer');
  try {
    const svar = await fetch('/api/alarmer');
    if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
    const alarmer = await svar.json();
    liste.replaceChildren(...alarmer.map((a) => alarmkort(fiendeFraAlarm(a))));
  } catch (e) {
    liste.replaceChildren(lag('li', 'feil', `Fant ingen alarmer (${e.message}). Kjører serveren? Du kan fortsatt mane fram din egen nedenfor.`));
  }
  liste.querySelector('button')?.focus();
}

function fiendeFraAlarm(a) {
  const klokka = a.tid.slice(11, 16); // lokal tid slik den står i alarmen
  return {
    id: a.id,
    navn: NAVN[a.tjeneste] ?? a.tjeneste.toUpperCase().replace(/[^A-ZÆØÅ]/g, '') + 'GAST',
    nivå: Number(klokka.replace(/\D/g, '')),
    type: TYPER[a.alvorlighet] ?? 'SKYGGE',
    tittel: a.tittel,
    klokka,
    tjeneste: a.tjeneste,
    oppgave: `ALARM kl ${klokka} natt til 29. oktober: ${a.tekst}`,
  };
}

function fiendeFraTekst(tekst) {
  const tjeneste = Object.keys(NAVN).find((t) => tekst.toLowerCase().includes(t));
  return {
    id: 'EGEN-' + hash(tekst).toString(16).slice(0, 4).toUpperCase(),
    navn: tjeneste ? NAVN[tjeneste] : 'UKJENT VESEN',
    nivå: '??',
    type: /kritisk|5\d\d|nede|krasj/i.test(tekst) ? 'BLOD' : 'SKYGGE',
    tittel: kort(tekst, 60),
    klokka: '??:??',
    tjeneste: tjeneste ?? 'ukjent',
    oppgave: tekst,
  };
}

function typemerke(type) {
  return lag('span', `typemerke ${type.toLowerCase()}`, type);
}

function alarmkort(fiende) {
  const li = lag('li');
  const knapp = lag('button', 'alarmkort');
  knapp.type = 'button';
  const lerret = lag('canvas');
  tegn(lerret, lagFiendeRutenett(fiende.id), PALETTER[fiende.type]);
  knapp.append(
    lerret,
    lag('span', 'kort-navn', `${fiende.navn}  Lv ${fiende.nivå}`),
    typemerke(fiende.type),
    lag('span', 'kort-tittel', fiende.tittel),
    lag('span', 'kort-tid', `kl ${fiende.klokka} · ${fiende.tjeneste}`),
  );
  knapp.setAttribute('aria-label', `${fiende.navn}, ${fiende.type}: ${fiende.tittel}, kl ${fiende.klokka}`);
  knapp.addEventListener('click', () => startKamp(fiende));
  li.append(knapp);
  return li;
}

// ---------- Kampen ----------

async function startKamp(fiende) {
  stoppKilde();
  kampNr++;
  kamp = {
    nr: kampNr, fiende, kilde: null, ferdig: false,
    uvisshet: 100, maks: 10, våken: 10, brukt: new Map(), treff: 0, kall: new Map(),
  };
  dialog.kø.length = 0;

  $('#kamp-id').textContent = `${fiende.id} · ${fiende.tjeneste} · kl ${fiende.klokka}`;
  $('#fiende-navn').textContent = fiende.navn;
  $('#fiende-nivå').textContent = `Lv ${fiende.nivå}`;
  $('#fiende-type').replaceWith(Object.assign(typemerke(fiende.type), { id: 'fiende-type' }));
  const sprite = $('#fiende-sprite');
  sprite.classList.remove('besvimt', 'treff');
  tegn(sprite, lagFiendeRutenett(fiende.id), PALETTER[fiende.type]);
  $('#logg').replaceChildren();
  $('#slutt').hidden = true;
  $('#dialog-tekst').textContent = '';
  oppdaterUvisshet(100);
  oppdaterVåken(10, 10);
  for (const li of document.querySelectorAll('#angrep li')) {
    li.classList.remove('aktiv');
    li.querySelector('.brukt').textContent = '';
  }

  visSkjerm('kamp');
  const kampEl = $('#kamp');
  kampEl.classList.remove('kamp-i-gang');
  if (!roligBevegelse.matches) {
    const overgang = $('#overgang');
    overgang.hidden = false;
    lyder.møte();
    await vent(900);
    overgang.hidden = true;
  }
  void kampEl.offsetWidth; // start inngangsanimasjonen på nytt
  kampEl.classList.add('kamp-i-gang');
  $('#flykt').focus();

  si(`En vill ${fiende.navn} dukket opp!`, 'fare');
  si('NATTEVAKT tenner lykta og går nærmere…');
  åpneKilde(fiende.oppgave, kampNr);
}

function åpneKilde(oppgave, nr) {
  const kilde = new EventSource(`/api/kjor?oppgave=${encodeURIComponent(oppgave)}`);
  kamp.kilde = kilde;
  kilde.onmessage = (e) => {
    if (kamp?.nr !== nr) return;
    let hendelse;
    try {
      hendelse = JSON.parse(e.data);
    } catch {
      return;
    }
    håndter(hendelse);
  };
  kilde.onerror = () => {
    kilde.close(); // ellers kobler EventSource til på nytt og starter agenten igjen
    if (kamp?.nr !== nr || kamp.ferdig) return;
    håndter({ type: 'feil', melding: 'Mistet forbindelsen til serveren.' });
  };
}

function stoppKilde() {
  kamp?.kilde?.close();
  if (kamp) kamp.ferdig = true;
}

function håndter(h) {
  switch (h.type) {
    case 'start':
      kamp.maks = h.maksIterasjoner;
      oppdaterVåken(h.maksIterasjoner, h.maksIterasjoner);
      logg('info', `Modell: ${h.modell} · maks ${h.maksIterasjoner} runder`);
      break;
    case 'runde':
      oppdaterVåken(Math.max(kamp.maks - h.nr, 0), kamp.maks);
      logg('runde', `— RUNDE ${h.nr} —`);
      break;
    case 'tekst':
      if (h.mellomtanke) {
        logg('tanke', h.tekst);
        si(`NATTEVAKT tenker: «${kort(h.tekst, 150)}»`, 'tanke');
        oppdaterUvisshet(kamp.uvisshet - 3);
      } else {
        si('NATTEVAKT skriver situasjonsrapporten…');
      }
      break;
    case 'verktoy_kall':
      angrep(h);
      break;
    case 'verktoy_resultat':
      resultat(h);
      break;
    case 'ferdig':
    case 'feil':
      avslutt(h);
      break;
  }
}

function angrep({ id, navn, input }) {
  const li = lag('li', 'kall');
  li.append(lag('div', 'kall-navn', `▸ ${angrepsnavn(navn)}`), lag('pre', '', JSON.stringify(input ?? {}, null, 1)), lag('div', 'venter', 'venter på svar…'));
  leggTilLogg(li);
  kamp.kall.set(id, li);

  kamp.brukt.set(navn, (kamp.brukt.get(navn) ?? 0) + 1);
  const meny = document.querySelector(`#angrep li[data-navn="${CSS.escape(navn)}"]`);
  if (meny) {
    meny.classList.add('aktiv');
    meny.querySelector('.brukt').textContent = `×${kamp.brukt.get(navn)}`;
    setTimeout(() => meny.classList.remove('aktiv'), 1600);
  }
  si(`NATTEVAKT brukte ${angrepsnavn(navn)}!`);
}

function resultat({ id, ok, tekst }) {
  const li = kamp.kall.get(id);
  if (li) {
    li.classList.add(ok ? 'ok' : 'bom');
    const detaljer = lag('details');
    const full = String(tekst ?? '');
    const vist = full.length > 20000 ? full.slice(0, 20000) + '\n… (kuttet i visningen)' : full;
    detaljer.append(lag('summary', '', ok ? `✓ ${full.length} tegn tilbake` : `✖ Bommet: ${kort(full, 80)}`), lag('pre', '', vist));
    li.querySelector('.venter')?.replaceWith(detaljer);
  }
  if (ok) {
    oppdaterUvisshet(kamp.uvisshet - 15);
    blink($('#fiende-sprite'), 'treff');
    lyder.treff();
    si(TREFFLINJER[kamp.treff++ % TREFFLINJER.length], 'godt');
  } else {
    oppdaterUvisshet(kamp.uvisshet + 5);
    blink($('#kamp'), 'rist');
    lyder.bom();
    si(`Det bommet… ${kort(tekst ?? '', 90)}`, 'fare');
  }
}

async function avslutt(h) {
  if (kamp.ferdig) return;
  const nr = kamp.nr;
  kamp.ferdig = true;
  kamp.kilde?.close();
  const navn = kamp.fiende.navn;

  let slutt;
  if (h.type === 'feil') {
    blink($('#kamp'), 'rist');
    si(`Et mørkt vesen kuttet tråden: ${kort(h.melding, 120)}`, 'fare');
    slutt = { seier: false, tittel: 'NATTEVAKT BESVIMTE…', under: `Noe gikk galt underveis: ${h.melding}` };
  } else if (h.grunn === 'end_turn') {
    oppdaterUvisshet(0);
    $('#fiende-sprite').classList.add('besvimt');
    si(`Den ville ${navn} løste seg opp i tåka!`, 'godt');
    slutt = { seier: true, tittel: 'UVISSHETEN ER FORVIST!', under: `${navn} er beseiret. Her er situasjonsrapporten:` };
  } else if (h.grunn === 'max_iterasjoner') {
    oppdaterVåken(0, kamp.maks);
    si('NATTEVAKT sovnet på vakt…', 'fare');
    slutt = { seier: false, tittel: 'NATTEVAKT SOVNET…', under: `Stoppet etter ${kamp.maks} runder (MAX_ITERASJONER) uten en ferdig rapport.` };
  } else if (h.grunn === 'refusal') {
    si('NATTEVAKT nekter å gå nærmere.', 'fare');
    slutt = { seier: false, tittel: 'NATTEVAKT SNUDDE…', under: 'Modellen avslo å fortsette.' };
  } else if (h.grunn === 'max_tokens') {
    si('NATTEVAKT mistet tråden midt i setningen…', 'fare');
    slutt = { seier: false, tittel: 'RAPPORTEN BLE KUTTET', under: 'Svaret nådde max_tokens. Det som rakk å bli skrevet:' };
  } else {
    return; // avbrutt: vi flyktet selv
  }

  await stille();
  await vent(roligBevegelse.matches ? 0 : 700);
  if (kamp?.nr !== nr) return;
  visSlutt(slutt, h.rapport ?? '');
}

function visSlutt({ seier, tittel, under }, rapport) {
  const slutt = $('#slutt');
  slutt.className = `slutt ${seier ? 'seier' : 'tap'}`;
  $('#slutt-tittel').textContent = tittel;
  $('#slutt-under').textContent = rapport || seier ? under : under.replace(/:$/, '.');
  $('#rapport').innerHTML = markdown(rapport);
  slutt.hidden = false;
  (seier ? lyder.seier : lyder.tap)();
  $('#ny-vakt').focus();
}

function flykt() {
  if (kamp && !kamp.ferdig) {
    stoppKilde();
    logg('info', 'Du flyktet. Agenten ble stoppet.');
  }
  kampNr++; // stopper dialogen som er i gang
  visVelg();
}

// ---------- Måleverdier ----------

function settBar(fyll, verdi, maks) {
  const andel = maks ? verdi / maks : 0;
  fyll.style.width = `${Math.round(andel * 100)}%`;
  fyll.classList.toggle('middels', andel <= 0.5 && andel > 0.2);
  fyll.classList.toggle('lav', andel <= 0.2);
}

function oppdaterUvisshet(verdi) {
  // Uvissheten går ikke helt til null før rapporten er skrevet.
  kamp.uvisshet = verdi === 0 ? 0 : Math.min(100, Math.max(6, verdi));
  settBar($('#uvisshet-fyll'), kamp.uvisshet, 100);
  $('#uvisshet-tall').textContent = `${kamp.uvisshet}/100`;
}

function oppdaterVåken(verdi, maks) {
  kamp.våken = verdi;
  settBar($('#våken-fyll'), verdi, maks);
  $('#våken-tall').textContent = `${verdi}/${maks} runder`;
}

function blink(el, klasse) {
  el.classList.remove(klasse);
  void el.offsetWidth;
  el.classList.add(klasse);
  el.addEventListener('animationend', () => el.classList.remove(klasse), { once: true });
}

// ---------- Kamploggen ----------

function leggTilLogg(li) {
  const liste = $('#logg');
  const nederst = liste.scrollHeight - liste.scrollTop - liste.clientHeight < 40;
  liste.append(li);
  if (nederst) liste.scrollTop = liste.scrollHeight;
}

const logg = (klasse, tekst) => leggTilLogg(lag('li', klasse, tekst));

async function lastAngrep() {
  const liste = $('#angrep');
  try {
    const svar = await fetch('/api/verktoy');
    if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
    const verktøy = await svar.json();
    liste.replaceChildren(...verktøy.map((v) => {
      const li = lag('li', v.aktiv ? '' : 'inaktiv');
      li.dataset.navn = v.navn;
      li.title = v.beskrivelse;
      li.append(lag('span', 'angrep-navn', angrepsnavn(v.navn)), lag('span', 'angrep-type', ANGREPSTYPER[v.navn] ?? 'UKJENT'), lag('span', 'brukt'));
      return li;
    }));
  } catch {
    liste.replaceChildren(lag('li', 'inaktiv', 'Fant ingen angrep.'));
  }
}

// ---------- Rapporten (enkel markdown, alltid escapet først) ----------

function escape(tekst) {
  return tekst.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(tekst) {
  return tekst
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
}

function tabellHtml(rader) {
  const celler = rader
    .filter((r) => !/^\s*\|?[\s|:-]+\|?\s*$/.test(r))
    .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
  const [hode, ...kropp] = celler;
  const th = hode.map((c) => `<th>${c}</th>`).join('');
  const td = kropp.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="tabell"><table><thead><tr>${th}</tr></thead><tbody>${td}</tbody></table></div>`;
}

function markdown(md) {
  const ut = [];
  let avsnitt = [];
  let liste = null;
  let tabell = null;
  let kode = null;

  const lukk = () => {
    if (avsnitt.length) ut.push(`<p>${inline(avsnitt.join(' '))}</p>`);
    if (liste) ut.push(`<${liste.tag}>${liste.punkter.map((p) => `<li>${inline(p)}</li>`).join('')}</${liste.tag}>`);
    if (tabell) ut.push(tabellHtml(tabell));
    avsnitt = [];
    liste = null;
    tabell = null;
  };

  for (const rå of md.replace(/\r/g, '').split('\n')) {
    const l = escape(rå);
    if (kode) {
      if (/^\s*```/.test(rå)) {
        ut.push(`<pre><code>${kode.join('\n')}</code></pre>`);
        kode = null;
      } else kode.push(l);
      continue;
    }
    let m;
    if (/^\s*```/.test(rå)) {
      lukk();
      kode = [];
    } else if ((m = l.match(/^\s*(#{1,6})\s+(.*)$/))) {
      lukk();
      const n = Math.min(m[1].length + 2, 6);
      ut.push(`<h${n}>${inline(m[2])}</h${n}>`);
    } else if ((m = l.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
      const tag = m[1] ? 'ol' : 'ul';
      if (avsnitt.length || tabell || (liste && liste.tag !== tag)) lukk();
      liste ??= { tag, punkter: [] };
      liste.punkter.push(m[2]);
    } else if (/^\s*\|.*\|\s*$/.test(l)) {
      if (!tabell) lukk();
      tabell ??= [];
      tabell.push(l);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      lukk();
      ut.push('<hr>');
    } else if (!l.trim()) {
      lukk();
    } else {
      if (liste || tabell) lukk();
      avsnitt.push(l.trim());
    }
  }
  if (kode) ut.push(`<pre><code>${kode.join('\n')}</code></pre>`);
  lukk();
  return ut.join('');
}

// ---------- Oppstart ----------

function init() {
  lagTittel();
  tegn($('#spiller-sprite'), SPILLER, SPILLERFARGER);
  lastAngrep();

  const start = () => { if (!$('#tittel').hidden) visVelg(); };
  $('#start').addEventListener('click', start);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#tittel').hidden && e.target === document.body) start();
  });
  $('#start').focus();

  $('#lyd').addEventListener('click', byttLyd);
  $('#flykt').addEventListener('click', flykt);
  $('#ny-vakt').addEventListener('click', flykt);
  $('#se-logg').addEventListener('click', () => {
    $('#slutt').hidden = true;
    $('#logg').focus();
  });
  $('#egen').addEventListener('submit', (e) => {
    e.preventDefault();
    const tekst = $('#egen-tekst').value.trim();
    if (tekst) startKamp(fiendeFraTekst(tekst));
  });
}

init();
