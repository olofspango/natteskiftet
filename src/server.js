// Webgrensesnittet: npm run web. Serverer public/ og strømmer agentens
// hendelser til nettleseren som Server-Sent Events.
import './env.js'; // først, så .env er lastet før agent.js leser process.env
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, verktøy } from './verktoy.js';
import { lagDashbord, lagPostMortem } from './rapport.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

const PORT = process.env.PORT ?? 3000;
const ROT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROT, 'public');
const ALARMER = path.join(ROT, 'data', 'alarmer.json');

const TYPER = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function send(res, status, type, innhold) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(innhold);
}

const ikkeFunnet = (res) => send(res, 404, 'text/plain; charset=utf-8', 'Fant ikke noe her. Bare tåke.');

function sendFil(res, fil) {
  const type = TYPER[path.extname(fil).toLowerCase()];
  if (!type) return ikkeFunnet(res);
  fs.readFile(fil, (feil, innhold) => (feil ? ikkeFunnet(res) : send(res, 200, type, innhold)));
}

function statisk(res, sti) {
  let relativ;
  try {
    relativ = decodeURIComponent(sti === '/' ? '/index.html' : sti);
  } catch {
    return ikkeFunnet(res);
  }
  const fil = path.resolve(PUBLIC, '.' + relativ);
  if (relativ.includes('\0') || !fil.startsWith(PUBLIC + path.sep)) return ikkeFunnet(res);
  sendFil(res, fil);
}

function listVerktøy() {
  return verktøy.map((v) => ({ navn: v.definisjon.name, beskrivelse: v.definisjon.description, aktiv: Boolean(v.kjør) }));
}

async function kjør(req, res, oppgave) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const skriv = (hendelse) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(hendelse)}\n\n`);
  };

  const avbryt = new AbortController();
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => {
    clearInterval(ping);
    avbryt.abort();
  });

  try {
    await kjørAgent({ system, oppgave, verktøy, påHendelse: skriv, signal: avbryt.signal });
  } catch (e) {
    if (!avbryt.signal.aborted) {
      console.error(`✖ ${e.message}`);
      skriv({ type: 'feil', melding: e.message });
    }
  } finally {
    clearInterval(ping);
    res.end();
  }
}

const MAKS_KROPP = 1_000_000;

async function lesJsonKropp(req) {
  let kropp = '';
  for await (const bit of req) {
    kropp += bit;
    if (kropp.length > MAKS_KROPP) throw new Error('For stor forespørsel.');
  }
  return JSON.parse(kropp || '{}');
}

// POST /api/dashbord og /api/postmortem: JSON inn, JSON ut.
async function svarJson(req, res, lag) {
  try {
    const resultat = await lag(await lesJsonKropp(req));
    send(res, 200, TYPER['.json'], JSON.stringify(resultat));
  } catch (e) {
    console.error(`✖ ${e.message}`);
    send(res, 500, TYPER['.json'], JSON.stringify({ feil: e.message }));
  }
}

const POST = { '/api/dashbord': lagDashbord, '/api/postmortem': lagPostMortem };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && POST[url.pathname]) return svarJson(req, res, POST[url.pathname]);
  if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'Bare GET her.');

  if (url.pathname === '/api/alarmer') return sendFil(res, ALARMER);
  if (url.pathname === '/api/verktoy') return send(res, 200, TYPER['.json'], JSON.stringify(listVerktøy()));
  if (url.pathname === '/api/kjor') {
    const oppgave = url.searchParams.get('oppgave')?.trim() || eksempelOppgave;
    console.log(`\n🎃 ${oppgave}\n`);
    return kjør(req, res, oppgave);
  }
  statisk(res, url.pathname);
});

server.listen(PORT, () => console.log(`🎃 Natteskiftet kjører på http://localhost:${PORT}`));
