import 'dotenv/config';
import app from './app.js';

// Fail fast en producción: sin estas variables la app arranca pero envía
// links a localhost en los correos (auth/cierres) o rechaza todo el cron.
if (process.env.NODE_ENV === 'production') {
  for (const key of ['DATABASE_URL', 'FRONTEND_URL', 'BACKEND_URL', 'CRON_SECRET']) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Pamir API running on port ${PORT}`);
});
