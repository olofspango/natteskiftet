// Startpunktet: npm start -- "spørsmålet ditt", eller npm run fullmane for alle alarmene
import './env.js'; // først, så .env er lastet før agent.js leser process.env
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, fullmåneOppgave, verktøy } from './verktoy.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

const argumenter = process.argv.slice(2);
const oppgave = argumenter[0] === '--fullmane' ? fullmåneOppgave : argumenter.join(' ') || eksempelOppgave;
console.log(`\n🎃 ${oppgave}\n`);

await kjørAgent({ system, oppgave, verktøy });
