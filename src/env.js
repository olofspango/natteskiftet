// Laster .env. Må importeres først i index.js: importer kjøres før resten av
// filen, så agent.js ville ellers lest process.env før .env var lastet.
try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}
