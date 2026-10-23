import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './config/db.js';
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import secretRoutes from './routes/secrets.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import { healthHandler } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // behind Railway's proxy — correct client IPs for the join and sign-in limits

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/secrets', secretRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

// Health check: a SELECT 1 with a short limit (503 while the database doesn't answer)
app.get('/health', healthHandler());

// Serve frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Boot resiliently. Exiting on any initDb() failure turns one unreachable-DB moment into a
// Railway crash loop that gives up after 10 restarts. Instead: retry a few times (the DB can
// be waking up), then start anyway so /health answers (503 while the database doesn't) and the
// real error is in the logs.
// DB-backed routes fail until Postgres is reachable; the next boot re-runs initDb().
async function start() {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await initDb();
      break;
    } catch (err) {
      console.error(`Database init attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err.message);
      if (attempt === MAX_ATTEMPTS) {
        console.error('Could not initialize the database. Starting anyway; DB-backed routes will fail until DATABASE_URL is reachable.');
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

start();
