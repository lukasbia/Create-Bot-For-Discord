const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { users } = require('../db/database');

function configure(passportInstance) {
  passportInstance.serializeUser((user, done) => {
    done(null, user.id);
  });

  passportInstance.deserializeUser((id, done) => {
    try {
      const user = users.findById(id);
      done(null, user || false);
    } catch (e) {
      done(e);
    }
  });

  const clientID = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

  if (clientID && clientSecret) {
    passportInstance.use(new GoogleStrategy({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['profile', 'email']
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const user = users.upsert(profile);
        return done(null, user);
      } catch (e) {
        return done(e);
      }
    }));
  } else {
    console.warn('[Auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set. OAuth disabled until configured.');
  }
}

module.exports = { configure };
