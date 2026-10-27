// Lokaler Start: node server/dev.js  (ohne Supabase nutzt er LOCAL_DB als JSON-Datei oder den Arbeitsspeicher)
import { createApp } from './app.js';
const port = Number(process.env.PORT) || 3000;
createApp({ serveStatic: true }).listen(port, () => console.log(`Fitness Coach läuft auf http://localhost:${port}`));
