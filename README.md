# CBScript Platform

BDFD-style Discord bot designer with the **CBScript** language.  
Runs on **UserLAnd Ubuntu** (Android) or any Linux / desktop Node.js host.

- Rounded iOS-18-tinted mobile UI
- Google OAuth login (required, no guest)
- Real discord.js bot hosting
- CBScript → JavaScript transpiler
- Scripts editor, live console, permanent variables, dashboard, settings

---

## Install on UserLAnd Ubuntu (Android)

1. Install **UserLAnd** from the Play Store.
2. Create an **Ubuntu** session and start it.
3. Inside the Ubuntu terminal:

```bash
sudo apt update
sudo apt install -y nodejs npm git unzip curl

# If node is too old (< 18), use NodeSource:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt install -y nodejs
```

4. Copy the project into Ubuntu (pick one method):

**Option A – from shared folder / Downloads**
```bash
# If you put the zip in UserLAnd shared storage:
cd ~
unzip /storage/Downloads/cbscript-platform.zip -d cbscript-platform
cd cbscript-platform
```

**Option B – download / create files yourself**
```bash
cd ~
mkdir -p cbscript-platform
# then place all project files inside
```

5. Configure and start:

```bash
cd ~/cbscript-platform
cp .env.example .env
nano .env
# Fill in:
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   GOOGLE_CALLBACK_URL=http://127.0.0.1:3000/auth/google/callback
#   SESSION_SECRET=any-long-random-string

npm install
npm start
```

6. Open the browser on your phone:
   - `http://127.0.0.1:3000`
   - or your device LAN IP if accessing from another device (update GOOGLE_CALLBACK_URL accordingly).

---

## Google OAuth

1. https://console.cloud.google.com/ → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URI must match `GOOGLE_CALLBACK_URL` exactly  
   Example: `http://127.0.0.1:3000/auth/google/callback`
4. Put Client ID + Secret into `.env`

---

## How to use

1. Login with Google
2. Tap **Create a bot** → enter name + Discord bot token
3. Open the bot → Dashboard → **Watch ad for 1 day hosting** (starts real discord.js process)
4. **Invite to Server**
5. Scripts tab → Create a script (default Hello World in CBScript)
6. Console / Variables / Settings via bottom nav

### Example CBScript
```text
<nif c{Hello World}
<nif reply{Hello World!,false}
```

---

## Project structure

```
cbscript-platform/
├── server.js                 # Express + Passport entry
├── package.json
├── .env.example
├── public/
│   ├── index.html
│   ├── css/app.css           # Rounded glass UI
│   └── js/app.js
└── src/
    ├── auth/passport.js
    ├── bots/manager.js       # Multi-bot discord.js host
    ├── db/database.js        # Pure JSON storage (no native deps)
    ├── routes/api.js
    └── transpiler/cbscript.js
```

Data is saved in `data/store.json`.

---

## Notes for UserLAnd

- Keep the Ubuntu session running while bots are online.
- Port 3000 must not be blocked.
- For external access use your phone’s Wi-Fi IP and update the Google callback URL.
- `npm install` may take a few minutes the first time.
