require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const cron = require('node-cron');

const { init, pool } = require('./db/schema');
const { JWT_SECRET } = require('./middleware/auth');
const { getOrCreateDm, isCaseMember, isCaseSolved, saveMessage } = require('./lib/chat');
const { runWeeklyResearch } = require('./lib/research');
const { runWeeklyAnalysis } = require('./lib/analysis');
const { renderCaseHtml } = require('./lib/seo');

const authRoutes = require('./routes/auth');
const regionsRoutes = require('./routes/regions');
const casesRoutes = require('./routes/cases');
const contributionsRoutes = require('./routes/contributions');
const membersRoutes = require('./routes/members');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const solveRequestsRoutes = require('./routes/solveRequests');
const translateRoutes = require('./routes/translate');
const notesRoutes = require('./routes/notes');

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (process kept alive):', err);
});

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS at the edge — needed so req.protocol reports https
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/regions', regionsRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api', contributionsRoutes);
app.use('/api', solveRequestsRoutes);
app.use('/api', translateRoutes);
app.use('/api', notesRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [payload.id]);
    if (!rows[0]) return next(new Error('Unauthorized'));
    socket.user = rows[0];
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', socket => {
  const { user } = socket;
  socket.join(`user:${user.id}`);

  // Join a case's group chat room — only allowed once you've joined its hunt.
  socket.on('case:join', async ({ caseId }) => {
    if (!(await isCaseMember(caseId, user.id))) return socket.emit('chat:error', 'Join the hunt first');
    socket.join(`case:${caseId}`);
  });

  socket.on('case:leave', ({ caseId }) => {
    socket.leave(`case:${caseId}`);
  });

  socket.on('case:message', async ({ caseId, body }) => {
    if (!body?.trim()) return;
    if (!(await isCaseMember(caseId, user.id))) return socket.emit('chat:error', 'Join the hunt first');
    if (await isCaseSolved(caseId)) return socket.emit('chat:error', 'This case is closed');
    const message = await saveMessage('case', caseId, user.id, body.trim());
    io.to(`case:${caseId}`).emit('case:message', { caseId, message });
  });

  socket.on('dm:message', async ({ toUserId, body }) => {
    if (!body?.trim() || !toUserId) return;
    if (Number(toUserId) === user.id) return;
    const convo = await getOrCreateDm(user.id, Number(toUserId));
    const message = await saveMessage('dm', convo.id, user.id, body.trim());
    io.to(`user:${user.id}`).to(`user:${toUserId}`).emit('dm:message', { conversationId: convo.id, message });
  });
});

const PORT = process.env.PORT || 4001;

const clientDist = path.join(__dirname, '../client/dist');

// Server-render per-case title/description/OG/Twitter tags for search
// engines and link-preview bots, which mostly don't run the SPA's JS. Reads
// live from the DB on every request, so newly created and already-existing
// cases both get correct tags with no separate generation step.
app.get('/cases/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const { rows } = await pool.query(
      `SELECT title, victim_name, summary FROM cases WHERE id = $1 AND status = 'approved'`,
      [req.params.id]
    );
    if (!rows[0]) return next();
    const canonicalUrl = `${req.protocol}://${req.get('host')}/cases/${req.params.id}`;
    res.set('Content-Type', 'text/html').send(renderCaseHtml(clientDist, rows[0], canonicalUrl));
  } catch (err) {
    console.error('Case SEO render failed:', err.message);
    next();
  }
});

app.use(express.static(clientDist));
app.get('{*path}', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

server.listen(PORT, async () => {
  console.log(`murdrclub server running on port ${PORT}`);
  try {
    await init();
    console.log('DB ready');
  } catch (err) {
    console.error('DB init failed:', err);
    process.exit(1);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    cron.schedule('0 6 * * 1', async () => {
      await runWeeklyResearch().catch(err => console.error('Weekly research run failed:', err.message));
      await runWeeklyAnalysis().catch(err => console.error('Weekly analysis run failed:', err.message));
    });
    console.log('Weekly case research + analysis scheduled (Mondays 06:00 UTC)');
  } else {
    console.log('ANTHROPIC_API_KEY not set — automated case research/analysis disabled');
  }
});
