// Agent-løkken. Hele «agent-greia» er dette: spør modellen, kjør verktøyene
// den ber om, send resultatene tilbake, gjenta til den er ferdig.
import Anthropic from '@anthropic-ai/sdk';

export const MODELL = process.env.MODELL ?? 'claude-sonnet-5-5';

// Stopper en agent som går i ring før den brenner opp kostnadstaket.
const MAX_ITERASJONER = Number(process.env.MAX_ITERASJONER ?? 10);

export const klient = new Anthropic();

const grå = (t) => `\x1b[90m${t}\x1b[0m`;
const oransje = (t) => `\x1b[38;5;208m${t}\x1b[0m`;
const grønn = (t) => `\x1b[32m${t}\x1b[0m`;

// påHendelse får strukturerte hendelser (for webgrensesnittet i server.js).
// signal avbryter kjøringen, f.eks. når nettleseren lukker forbindelsen.
export async function kjørAgent({ system, oppgave, verktøy, påHendelse = () => {}, signal }) {
  // Bare verktøy med en kjør-funksjon sendes til modellen. Stubbene i
  // verktoy.js blir med av seg selv når dere implementerer dem.
  const aktive = verktøy.filter((v) => v.kjør);
  const etterNavn = new Map(aktive.map((v) => [v.definisjon.name, v]));
  const ferdig = (grunn, svar) => påHendelse({ type: 'ferdig', grunn, rapport: svar ? rapportFra(svar) : '' });

  påHendelse({ type: 'start', oppgave, modell: MODELL, maksIterasjoner: MAX_ITERASJONER });

  const messages = [{ role: 'user', content: oppgave }];

  for (let i = 1; i <= MAX_ITERASJONER; i++) {
    if (signal?.aborted) return ferdig('avbrutt');
    påHendelse({ type: 'runde', nr: i });

    let svar;
    try {
      svar = await klient.messages.create({
        model: MODELL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system,
        tools: aktive.map((v) => v.definisjon),
        messages,
      }, { signal });
    } catch (e) {
      if (signal?.aborted) return ferdig('avbrutt');
      throw e;
    }

    messages.push({ role: 'assistant', content: svar.content });

    for (const blokk of svar.content) {
      if (blokk.type === 'text' && blokk.text.trim()) {
        const mellomtanke = svar.stop_reason === 'tool_use';
        console.log(mellomtanke ? grå(blokk.text) : blokk.text);
        påHendelse({ type: 'tekst', tekst: blokk.text, mellomtanke });
      }
    }

    if (svar.stop_reason === 'end_turn') {
      ferdig('end_turn', svar);
      return svar;
    }
    if (svar.stop_reason === 'refusal') {
      console.log(oransje(`\n✖ Modellen avslo (${svar.stop_details?.category ?? 'ukjent grunn'}).`));
      ferdig('refusal', svar);
      return svar;
    }
    if (svar.stop_reason === 'max_tokens') {
      console.log(oransje('\n✖ Svaret ble kuttet (max_tokens).'));
      ferdig('max_tokens', svar);
      return svar;
    }

    // Modellen kan be om flere verktøy samtidig. Alle resultatene må tilbake
    // i én og samme melding.
    const kall = svar.content.filter((b) => b.type === 'tool_use');
    const resultater = [];
    for (const k of kall) {
      if (signal?.aborted) return ferdig('avbrutt');
      console.log(oransje(`→ ${k.name}`) + grå(` ${JSON.stringify(k.input)}`));
      påHendelse({ type: 'verktoy_kall', id: k.id, navn: k.name, input: k.input });
      const resultat = await kjørVerktøy(etterNavn, k);
      påHendelse({ type: 'verktoy_resultat', id: k.id, navn: k.name, ok: !resultat.is_error, tekst: resultat.content });
      resultater.push(resultat);
    }
    messages.push({ role: 'user', content: resultater });
  }

  console.log(oransje(`\n✖ Stoppet etter ${MAX_ITERASJONER} runder (MAX_ITERASJONER).`));
  ferdig('max_iterasjoner');
}

function rapportFra(svar) {
  return svar.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
}

async function kjørVerktøy(etterNavn, kall) {
  const v = etterNavn.get(kall.name);
  if (!v) {
    return feil(kall, `Ukjent verktøy «${kall.name}». Gyldige: ${[...etterNavn.keys()].join(', ')}`);
  }
  try {
    const resultat = await v.kjør(kall.input);
    const tekst = typeof resultat === 'string' ? resultat : JSON.stringify(resultat, null, 2);
    console.log(grønn(`  ✓ ${tekst.length} tegn tilbake`));
    // console.log(tekst)
    return { type: 'tool_result', tool_use_id: kall.id, content: tekst };
  } catch (e) {
    return feil(kall, e.message);
  }
}

function feil(kall, melding) {
  console.log(oransje(`  ✖ ${melding}`));
  return { type: 'tool_result', tool_use_id: kall.id, content: melding, is_error: true };
}
