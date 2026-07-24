require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { init, db } = require('./db/schema');
const { JWT_SECRET } = require('./middleware/auth');
const { getOrCreateDm, isCaseMember, saveMessage } = require('./lib/chat');

const authRoutes = require('./routes/auth');
const regionsRoutes = require('./routes/regions');
const casesRoutes = require('./routes/cases');
const contributionsRoutes = require('./routes/contributions');
const membersRoutes = require('./routes/members');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (process kept alive):', err);
});

init();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/regions', regionsRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api', contributionsRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('Unauthorized'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', socket => {
  const { user } = socket;
  socket.join(`user:${user.id}`);

  // Join a case's group chat room — only allowed once you've joined its hunt.
  socket.on('case:join', ({ caseId }) => {
    if (!isCaseMember(caseId, user.id)) return socket.emit('chat:error', 'Join the hunt first');
    socket.join(`case:${caseId}`);
  });

  socket.on('case:leave', ({ caseId }) => {
    socket.leave(`case:${caseId}`);
  });

  socket.on('case:message', ({ caseId, body }) => {
    if (!body?.trim()) return;
    if (!isCaseMember(caseId, user.id)) return socket.emit('chat:error', 'Join the hunt first');
    const message = saveMessage('case', caseId, user.id, body.trim());
    io.to(`case:${caseId}`).emit('case:message', { caseId, message });
  });

  socket.on('dm:message', ({ toUserId, body }) => {
    if (!body?.trim() || !toUserId) return;
    if (Number(toUserId) === user.id) return;
    const convo = getOrCreateDm(user.id, Number(toUserId));
    const message = saveMessage('dm', convo.id, user.id, body.trim());
    io.to(`user:${user.id}`).to(`user:${toUserId}`).emit('dm:message', { conversationId: convo.id, message });
  });
});

const PORT = process.env.PORT || 4001;

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('{*path}', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

server.listen(PORT, () => {
  console.log(`murdrclub server running on port ${PORT}`);
});
