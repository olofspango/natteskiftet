# AGENTS.md

Natteskiftet: an on-call agent that takes the first shift when an alarm fires at 03:00. It digs through logs, deploy history and runbooks, then writes an honest situation report in Norwegian. All data is fictional (night of 29 October 2026).

## Commands

```bash
npm install
npm start                                   # runs the example alarm (betaling 03:12)
npm start -- "ALARM kl 03:40: api-gateway gir 17 % 504"
npm run fullmane                            # all five alarms at once: root cause vs symptom
npm test                                    # not implemented yet
```

`npm start` needs `ANTHROPIC_API_KEY` in `.env` (copy from `.env.example`). Never commit `.env` and never print its contents.

## Verifying changes

After every change, run `npm start` and check that the agent still behaves as expected:

- The run finishes without errors.
- Tool calls are made and return sensible output (not empty or error text caused by your change).
- The final report covers severity, affected service, probable cause, what is unknown, and next step.

When `npm test` exists, run it too. Until then, you can exercise a tool directly without the model:

```bash
node -e "import('./src/verktoy.js').then(async m => {
  const t = m.verktøy.find(v => v.definisjon.name === 'sjekk_deploy_historikk');
  console.log(await t.kjør({ tjeneste: 'betaling' }));
})"
```

If you could not run something (no API key, no network), say so in your report instead of claiming it works.

## Layout

```
src/index.js                 entry point, reads the alarm text from the command line
src/agent.js                 agent loop: ask model, run tools, repeat (MAX_ITERASJONER, default 10)
src/verktoy.js               system prompt, example alarm, tool definitions and implementations
data/alarmer.json            five alarms
data/logger.json             ~250 log lines, 02:30-03:50
data/runbooks/*.md           per-service runbooks (not all up to date)
data/deploy-historikk.json   deploys and config changes
data/hendelser.json          past incidents with post-mortems
data/tjenester.json          owner teams, on-call, dependencies
```

## Conventions

- Code, identifiers, comments and prompts are in Norwegian. Match the surrounding style and comment density.
- A tool is `{ definisjon, kjør }`. `kjør: null` is a stub and is not sent to the model until implemented.
- Tool names must be ASCII (`sok_i_logger`, not `søk_i_logger`).
- Tool descriptions are prompts. Write them as to a new colleague: when to use the tool and what to watch out for. Wording changes affect how the model calls the tool, so re-run `npm start` after editing them.
- Tools throw `Error` with a helpful message (including valid values); the model gets it back and can retry. Empty results should say how to broaden the search.
- Time arguments accept full ISO or `"03:10"`, interpreted as 29 Oct 2026, Norwegian time (+01:00).
- The agent must separate what it saw in the data from what it assumes, and state what it does not know. Do not weaken this in the system prompt.
