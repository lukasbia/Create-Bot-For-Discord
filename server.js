require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { configure } = require('./src/auth/passport');
const apiRoutes = require('./src/routes/api');
const manager = require('./src/bots/manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & performance
app.use(helmet({
  contentSecurityPolicy: false, // allow inline for the SPA style UI
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'cbscript-super-secret-change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Passport
configure(passport);
app.use(passport.initialize());
app.use(passport.session());

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes
app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).send(`
      <html><body style="font-family:system-ui;background:#0f0f12;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;max-width:420px;padding:24px">
          <h1>Google OAuth not configured</h1>
          <p>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>GOOGLE_CALLBACK_URL</code> in your <code>.env</code> file.</p>
          <p style="opacity:0.7;font-size:14px">Create credentials at console.cloud.google.com → APIs & Services → Credentials</p>
        </div>
      </body></html>
    `);
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        avatar: req.user.avatar
      }
    });
  }
  res.json({ authenticated: false });
});

// API
app.use('/api', apiRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║   CBScript Platform  •  http://0.0.0.0:${PORT}   ║`);
  console.log(`  ║   Mobile-ready • Termux friendly             ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down bots...');
  for (const id of manager.clients.keys()) {
    await manager.stopBot(id);
  }
  process.exit(0);
});
