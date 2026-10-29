// Etter kampen: gjør situasjonsrapporten om til et dashbord, og skriv en
// post-mortem når hendelsen er over. Ett modellkall hver, uten verktøy.
import fs from 'node:fs';
import path from 'node:path';
import { klient, MODELL } from './agent.js';

const DATA = path.join(import.meta.dirname, '..', 'data');

const liste = { type: 'array', items: { type: 'string' } };

// Strukturerte svar: modellen må følge skjemaet, så dashbordet slipper å tolke markdown.
const DASHBORD_SKJEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tittel', 'alvorlighet', 'alvorlighet_tekst', 'berørte_tjenester', 'sannsynlig_årsak', 'sikkerhet',
    'sett_i_dataene', 'antakelser', 'vet_ikke', 'neste_steg', 'hvem_vekkes', 'alarmer'],
  properties: {
    tittel: { type: 'string', description: 'Hva som skjer, i én kort linje.' },
    alvorlighet: { type: 'string', enum: ['kritisk', 'høy', 'middels', 'lav', 'ukjent'] },
    alvorlighet_tekst: { type: 'string', description: 'Alvorligheten slik rapporten skriver den, f.eks. "SEV-2".' },
    berørte_tjenester: liste,
    sannsynlig_årsak: { type: 'string', description: 'Én til to setninger.' },
    sikkerhet: { type: 'string', enum: ['høy', 'middels', 'lav', 'ikke oppgitt'], description: 'Hvor sikker rapporten selv sier den er på årsaken.' },
    sett_i_dataene: { ...liste, description: 'Funn rapporten sier den har sett i logger, deployer osv. Ta med tidspunkt.' },
    antakelser: { ...liste, description: 'Det rapporten antar eller tror, men ikke har bekreftet.' },
    vet_ikke: { ...liste, description: 'Det rapporten sier at den ikke vet.' },
    neste_steg: { ...liste, description: 'Foreslåtte neste steg, viktigst først.' },
    hvem_vekkes: { type: 'string', description: 'Hvem som bør vekkes eller varsles. Tom streng hvis rapporten ikke sier det.' },
    alarmer: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tjeneste', 'rolle', 'begrunnelse'],
        properties: {
          id: { type: 'string', description: 'Alarm-id hvis rapporten nevner den, ellers tom streng.' },
          tjeneste: { type: 'string' },
          rolle: { type: 'string', enum: ['rotårsak', 'symptom', 'uavhengig', 'uavklart'] },
          begrunnelse: { type: 'string', description: 'Kort: hva i dataene rollen bygger på, og hva den er symptom på.' },
        },
      },
    },
  },
};

const DASHBORD_SYSTEM = `Du gjør en situasjonsrapport fra nattevakt-agenten om til felter for et dashbord.
Hent bare ut det som står i rapporten. Ikke legg til egne funn, årsaker eller tiltak.
Hold skillet mellom det rapporten har sett i dataene og det den antar. Er du i tvil, legg det under antakelser.
Står det ikke i rapporten, bruk "ukjent", "ikke oppgitt", tom streng eller tom liste.
Kort og konkret norsk. Hvert punkt i listene er én linje.`;

export async function lagDashbord({ rapport }) {
  if (!rapport?.trim()) throw new Error('Mangler situasjonsrapporten.');
  const svar = await klient.messages.create({
    model: MODELL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: DASHBORD_SKJEMA } },
    system: DASHBORD_SYSTEM,
    messages: [{ role: 'user', content: `<situasjonsrapport>\n${rapport}\n</situasjonsrapport>` }],
  });
  const tekst = svar.content.find((b) => b.type === 'text')?.text;
  if (svar.stop_reason !== 'end_turn' || !tekst) throw new Error(`Fikk ikke laget dashbordet (${svar.stop_reason}).`);
  return JSON.parse(tekst);
}

const POSTMORTEM_SYSTEM = `Du skriver en post-mortem på norsk etter en hendelse natt til 29. oktober 2026.
Du får alarmen, situasjonsrapporten fra nattevakt-agenten, sporet av det agenten undersøkte, tjenesteoversikten og eventuelt notater fra den som håndterte hendelsen.
Skriv blameless: beskriv systemer, endringer og beslutninger, ikke hvem som har skylda.
Bruk bare det som står i materialet. Skill mellom det som er sett i dataene og det som er antatt.
Det du ikke vet, skriver du som ukjent i stedet for å gjette. Har ingen fortalt når eller hvordan hendelsen ble løst, så si det.

Bruk denne strukturen i markdown:
# <kort tittel>
**Alvorlighet:** … · **Berørte tjenester:** … · **Varighet:** … (bare hvis den kan regnes ut fra materialet, ellers «ukjent»)
## Sammendrag
## Tidslinje
Tabell med Tid | Hendelse | Kilde (logg, deploy, alarm, notat). Eldst først, tidspunkter fra materialet.
## Rotårsak
## Utløsende og bidragende faktorer
## Påvirkning
## Oppdagelse og håndtering
## Hva gikk bra
## Hva kunne gått bedre
## Tiltak
Tabell med Tiltak | Type (umiddelbart, forebyggende eller overvåking) | Eier-team (fra tjenesteoversikten).
## Det vi ikke vet`;

const MAKS_SPOR_TEGN = 4000;

function sporTekst(spor = []) {
  return spor.map((s, i) => {
    const svar = String(s.tekst ?? '');
    const vist = svar.length > MAKS_SPOR_TEGN ? svar.slice(0, MAKS_SPOR_TEGN) + '\n… (kuttet)' : svar;
    return `${i + 1}. ${s.navn} ${JSON.stringify(s.input ?? {})}${s.ok ? '' : ' (feilet)'}\n${vist}`;
  }).join('\n\n');
}

export async function lagPostMortem({ oppgave, rapport, spor, notater }) {
  if (!rapport?.trim()) throw new Error('Mangler situasjonsrapporten.');
  const innhold = [
    `<alarm>\n${oppgave ?? 'ukjent'}\n</alarm>`,
    `<situasjonsrapport>\n${rapport}\n</situasjonsrapport>`,
    `<undersokelse>\n${sporTekst(spor) || 'Ingen verktøykall registrert.'}\n</undersokelse>`,
    `<tjenester>\n${fs.readFileSync(path.join(DATA, 'tjenester.json'), 'utf8')}\n</tjenester>`,
    `<notater_fra_vakthavende>\n${notater?.trim() || 'Ingen notater. Hvordan og når hendelsen ble løst er ikke oppgitt.'}\n</notater_fra_vakthavende>`,
  ].join('\n\n');

  const svar = await klient.messages.create({
    model: MODELL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: POSTMORTEM_SYSTEM,
    messages: [{ role: 'user', content: innhold }],
  });
  const tekst = svar.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
  if (!tekst) throw new Error(`Fikk ikke skrevet post-mortem (${svar.stop_reason}).`);
  return { markdown: tekst, kuttet: svar.stop_reason === 'max_tokens' };
}
