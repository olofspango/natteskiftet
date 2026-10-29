// Verktøyene til natteskift-agenten. Et verktøy er en definisjon (det modellen
// ser) og en kjør-funksjon (det som faktisk skjer). kjør: null betyr stub: den
// sendes ikke til modellen før dere implementerer den.
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(import.meta.dirname, '..', 'data');
const lesJson = (fil) => JSON.parse(fs.readFileSync(path.join(DATA, fil), 'utf8'));

export const system = `Du tar første vakt når en alarm går om natta, før et menneske rekker å åpne laptopen.
Grav i loggene og de andre kildene til du har en hypotese om hva som skjer og hvorfor.
Skill mellom det du har sett i dataene og det du antar. Si eksplisitt hva du ikke vet.
En agent som gjetter på et produksjonsproblem er verre enn ingen agent.
Sjekk om andre alarmer har gått i natt. Henger de sammen, er det én hendelse, og da skal ikke fem mennesker vekkes for ett problem.
Gå avhengighetene og avgjør for hver alarm om den er rotårsak, symptom på noe annet, eller uavhengig. Rotårsaken kan ligge i en tjeneste som ikke alarmerer.
At to tjenester henger sammen i grafen, eller at alarmene kom tett i tid, beviser ingenting. Kall bare noe et symptom når loggene viser koblingen.
Avslutt med en kort situasjonsrapport på norsk: alvorlighet, berørt tjeneste, sannsynlig årsak, hva du ikke vet, og foreslått neste steg.
Har du sett på flere alarmer, ta med én linje per alarm: rotårsak, symptom (på hva) eller uavhengig, og hva i dataene du bygger det på.`;

export const eksempelOppgave =
  'ALARM kl 03:12 natt til 29. oktober: betaling: andel 5xx-svar siste 5 min er 9.4 % (terskel 5 %). Gjelder POST /betaling/trekk.';

// npm run fullmane: alle alarmene på en gang, uten hint om hvilken som er verst.
export const fullmåneOppgave =
  'Klokka er 03:45 natt til 29. oktober. Telefonen har ringt fem ganger den siste timen. ' +
  'Finn ut hvilke alarmer som henger sammen, hva som er rotårsaken, og hva som kan vente til i morgen.';

// Godtar full ISO-tid eller bare "03:10" (tolkes som natt til 29. okt 2026, norsk tid).
function tilMs(tid) {
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(tid)) tid = `2026-10-29T${tid.padStart(5, '0')}+01:00`;
  const ms = Date.parse(tid);
  if (Number.isNaN(ms)) throw new Error(`Skjønner ikke tidspunktet «${tid}». Bruk f.eks. "03:10" eller "2026-10-29T03:10:00+01:00".`);
  return ms;
}

function sokILogger({ tjeneste, niva, fra, til, tekst, maks = 50 } = {}) {
  const fraMs = fra ? tilMs(fra) : -Infinity;
  const tilMsVerdi = til ? tilMs(til) : Infinity;
  const logger = lesJson('logger.json');
  const kjente = [...new Set(logger.map((l) => l.tjeneste))];
  if (tjeneste && !kjente.includes(tjeneste)) throw new Error(`Ukjent tjeneste «${tjeneste}». Gyldige: ${kjente.join(', ')}`);
  const treff = logger.filter((l) =>
    (!tjeneste || l.tjeneste === tjeneste) &&
    (!niva || l.nivå === niva.toUpperCase()) &&
    (!tekst || l.melding.toLowerCase().includes(tekst.toLowerCase())) &&
    Date.parse(l.tid) >= fraMs && Date.parse(l.tid) <= tilMsVerdi);

  const grense = Math.min(Math.max(Number(maks) || 50, 1), 200);
  if (treff.length === 0) return 'Ingen logglinjer matchet filteret. Prøv et bredere søk.';
  const linjer = treff.slice(0, grense).map((l) => `${l.tid} ${l.tjeneste} ${l.nivå} ${l.melding}`);
  if (treff.length > grense) linjer.push(`... ${treff.length - grense} linjer til. Snevre inn søket eller øk maks.`);
  return linjer.join('\n');
}

function hentRunbook({ tjeneste } = {}) {
  const mappe = path.join(DATA, 'runbooks');
  const kjente = fs.readdirSync(mappe).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  if (!tjeneste || !kjente.includes(tjeneste)) throw new Error(`Fant ingen runbook for «${tjeneste}». Runbooks som finnes: ${kjente.join(', ')}`);
  return fs.readFileSync(path.join(mappe, `${tjeneste}.md`), 'utf8');
}

function sjekkDeployHistorikk({ tjeneste, siden } = {}) {
  const sidenMs = siden ? tilMs(siden) : -Infinity;
  const treff = lesJson('deploy-historikk.json')
    .filter((d) => (!tjeneste || d.tjeneste === tjeneste) && Date.parse(d.tid) > sidenMs)
    .sort((a, b) => Date.parse(b.tid) - Date.parse(a.tid));
  if (treff.length === 0) return 'Ingen endringer matchet filteret.';
  return treff.map((d) => `${d.tid} ${d.tjeneste} ${d.versjon} (${d.av}): ${d.endring}`).join('\n');
}

function finnLignendeHendelser({ tjeneste, tekst } = {}) {
  const sok = tekst?.toLowerCase();
  const treff = lesJson('hendelser.json').filter((h) =>
    (!tjeneste || h.tjeneste === tjeneste) &&
    (!sok || [h.tittel, h.sammendrag, h.rotårsak].some((felt) => felt?.toLowerCase().includes(sok))));
  if (treff.length === 0) return 'Ingen tidligere hendelser matchet. Prøv et bredere søk.';
  return treff.map((h) =>
    `${h.id} (${h.dato}, ${h.tjeneste}, ${h.alvorlighet}): ${h.tittel}\n` +
    `  Sammendrag: ${h.sammendrag}\n  Rotårsak: ${h.rotårsak}\n  Tiltak: ${h.tiltak}\n  Varighet: ${h.varighet_min} min`).join('\n\n');
}

function hentAlleAktiveAlarmer({ fra, til } = {}) {
  const fraMs = fra ? tilMs(fra) : -Infinity;
  const tilMsVerdi = til ? tilMs(til) : Infinity;
  const alarmer = lesJson('alarmer.json')
    .filter((a) => Date.parse(a.tid) >= fraMs && Date.parse(a.tid) <= tilMsVerdi)
    .sort((a, b) => Date.parse(a.tid) - Date.parse(b.tid));
  if (alarmer.length === 0) return 'Ingen alarmer i tidsvinduet. Utelat fra og til for å se alle.';
  const medAlarm = new Set(alarmer.map((a) => a.tjeneste));
  const utenAlarm = lesJson('tjenester.json').map((t) => t.navn).filter((n) => !medAlarm.has(n));
  return [
    ...alarmer.map((a) => `${a.tid} ${a.id} ${a.tjeneste} [${a.alvorlighet}] ${a.tittel}: ${a.tekst}`),
    '',
    `Tjenester uten alarm: ${utenAlarm.join(', ') || 'ingen'}`,
  ].join('\n');
}

// Alt som kan nås fra start ved å følge naboer, også indirekte. Start er ikke med.
function nåbare(start, naboer) {
  const sett = new Set();
  const kø = [...naboer(start)];
  while (kø.length) {
    const n = kø.shift();
    if (n === start || sett.has(n)) continue;
    sett.add(n);
    kø.push(...naboer(n));
  }
  return [...sett];
}

function hentAvhengigheter({ tjeneste } = {}) {
  const tjenester = lesJson('tjenester.json');
  const etterNavn = new Map(tjenester.map((t) => [t.navn, t]));
  if (tjeneste && !etterNavn.has(tjeneste)) throw new Error(`Ukjent tjeneste «${tjeneste}». Gyldige: ${[...etterNavn.keys()].join(', ')}`);

  // Hver tjeneste merkes med alarmene sine, så modellen ser hvor i grafen det brenner.
  const alarmer = lesJson('alarmer.json');
  const merke = (navn) => {
    if (!etterNavn.has(navn)) return `${navn} [ekstern, ingen data]`;
    const egne = alarmer.filter((a) => a.tjeneste === navn).map((a) => `${a.id} ${a.tittel}`);
    return `${navn} [${egne.join('; ') || 'ingen alarm'}]`;
  };
  const liste = (navn) => navn.map(merke).join(', ') || '(ingen)';
  const avhengerAv = (n) => etterNavn.get(n)?.avhengigheter ?? [];
  const brukesAv = (n) => tjenester.filter((t) => t.avhengigheter.includes(n)).map((t) => t.navn);

  if (!tjeneste) {
    return tjenester.map((t) =>
      `${merke(t.navn)}, eid av ${t.eier_team}\n  ${t.beskrivelse}\n  Avhenger av: ${liste(t.avhengigheter)}`).join('\n\n');
  }
  const t = etterNavn.get(tjeneste);
  const indirekte = (direkte, naboer) => nåbare(tjeneste, naboer).filter((n) => !direkte.includes(n));
  return [
    `${merke(tjeneste)}, eid av ${t.eier_team}`,
    `  ${t.beskrivelse}`,
    'Avhenger av (feil her kan smitte hit):',
    `  direkte: ${liste(t.avhengigheter)}`,
    `  indirekte: ${liste(indirekte(t.avhengigheter, avhengerAv))}`,
    'Brukes av (feil her kan smitte dit):',
    `  direkte: ${liste(brukesAv(tjeneste))}`,
    `  indirekte: ${liste(indirekte(brukesAv(tjeneste), brukesAv))}`,
  ].join('\n');
}

export const verktøy = [
  {
    definisjon: {
      name: 'sok_i_logger',
      description:
        'Søker i loggene fra natt til 29. oktober 2026 (ca 02:30-03:50). Alle filtre er valgfrie og kan kombineres. ' +
        'Tjenester: api-gateway, innlogging, betaling, sok, varsling, kunde-db. ' +
        'Start gjerne bredt (én tjeneste, et tidsvindu rundt alarmen) og snevre inn med tekst når du ser noe interessant. ' +
        'Husk at feilen ofte sitter i en annen tjeneste enn den som alarmerer.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "betaling".' },
          niva: { type: 'string', enum: ['INFO', 'WARN', 'ERROR'], description: 'Bare linjer med dette nivået.' },
          fra: { type: 'string', description: 'Fra og med tidspunkt, "03:00" eller full ISO-tid.' },
          til: { type: 'string', description: 'Til og med tidspunkt, "03:15" eller full ISO-tid.' },
          tekst: { type: 'string', description: 'Tekst som må finnes i meldingen (ikke skille på store/små bokstaver).' },
          maks: { type: 'number', description: 'Maks antall linjer tilbake. Standard 50, høyst 200.' },
        },
      },
    },
    kjør: async (input) => sokILogger(input),
  },
  {
    definisjon: {
      name: 'hent_runbook',
      description:
        'Henter runbooken for en tjeneste: hva teamet anbefaler å gjøre ved kjente feil, og hvem som skal vekkes. ' +
        'Sjekk datoen øverst. En gammel runbook kan beskrive oppsett som ikke finnes lenger, så sammenlign med det du ser i loggene.',
      input_schema: {
        type: 'object',
        properties: { tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "sok".' } },
        required: ['tjeneste'],
      },
    },
    kjør: async (input) => hentRunbook(input),
  },
  {
    definisjon: {
      name: 'sjekk_deploy_historikk',
      description:
        'Viser utrullinger og konfigendringer, nyest først. Bruk den for å finne ut om noe ble endret rett før problemene startet. ' +
        'Husk at konfig- og cron-endringer også teller, og at en endring for flere dager siden kan slå inn først nå.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Bare endringer for denne tjenesten. Utelat for alle.' },
          siden: { type: 'string', description: 'Bare endringer etter dette tidspunktet (ISO-tid).' },
        },
      },
    },
    kjør: async (input) => sjekkDeployHistorikk(input),
  },
  {
    definisjon: {
      name: 'finn_lignende_hendelser',
      description:
        'Søker i tidligere hendelser med post-mortem: hva skjedde, rotårsak, hva som ble gjort og hvor lenge det varte. ' +
        'Nyttig for å se om dette har skjedd før. Vær nøye med forskjellene: en hendelse som ligner, er ikke nødvendigvis samme feil.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Bare hendelser for denne tjenesten.' },
          tekst: { type: 'string', description: 'Søkeord, f.eks. "disk" eller "timeout".' },
        },
      },
    },
    kjør: async (input) => finnLignendeHendelser(input),
  },
  {
    definisjon: {
      name: 'hent_alle_aktive_alarmer',
      description:
        'Viser alle alarmer som har gått i natt, eldst først, og hvilke tjenester som ikke alarmerer. ' +
        'Bruk den tidlig, også når du bare har fått én alarm: flere alarmer tett i tid kan være én hendelse, eller flere uavhengige. ' +
        'Husk at en tjeneste uten alarm ikke dermed er frisk. Den kan mangle overvåking på akkurat det som feiler.',
      input_schema: {
        type: 'object',
        properties: {
          fra: { type: 'string', description: 'Fra og med tidspunkt, "03:00" eller full ISO-tid.' },
          til: { type: 'string', description: 'Til og med tidspunkt, "03:45" eller full ISO-tid.' },
        },
      },
    },
    kjør: async (input) => hentAlleAktiveAlarmer(input),
  },
  {
    definisjon: {
      name: 'hent_avhengigheter',
      description:
        'Viser hvem en tjeneste avhenger av og hvem som bruker den, direkte og indirekte, med alarmene til hver tjeneste. ' +
        'Utelat tjeneste for å få hele grafen. Bruk den til å finne ut om en alarm kan være et symptom på feil lenger ned i kjeden. ' +
        'En kant i grafen viser bare at en feil kan smitte, ikke at den gjorde det. Bekreft sammenhengen i loggene før du kaller noe et symptom.',
      input_schema: {
        type: 'object',
        properties: { tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "api-gateway". Utelat for hele grafen.' } },
      },
    },
    kjør: async (input) => hentAvhengigheter(input),
  },
];
