# CBScript Platform v1.0

A full-featured Discord bot hosting platform that runs on your Android phone via Termux. Build bots with **CBScript** (custom language), JavaScript, or Python.

---

## Features

- **Discord OAuth Login** — No guest mode, secure session-based auth
- **Bot Management** — Create, edit, delete bots with tokens
- **CBScript Compiler** — Transpiles CBScript to JavaScript automatically
- **Real Hosting** — Bots actually connect to Discord via discord.js
- **Ad System** — Watch ad (5s timer) to get 24h hosting credits
- **Script Editor** — Floating window code editor with line/char counter
- **Console** — Real-time logs with auto-refresh
- **Variables** — Persistent global/user/guild scoped variables
- **iOS 18 UI** — Fully rounded, tinted glassmorphism design
- **Bottom Navigation** — Dashboard, Scripts, Console, Variables, Settings

---

## Setup on Android (Termux)

### 1. Install dependencies
```bash
pkg update && pkg upgrade
pkg install nodejs git
```

### 2. Clone or transfer the project
```bash
cd ~
# If you have it in a zip:
# unzip cbscript-platform.zip -d cbscript-platform
cd cbscript-platform
npm install
```

### 3. Create your Discord App
1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "CBScript Platform"
3. Go to **OAuth2** → **General**
4. Add redirect URI: `http://YOUR_IP:3000/auth/callback`
   - For local testing: `http://localhost:3000/auth/callback`
   - For public access: `http://your-public-url:3000/auth/callback`
5. Copy **Client ID** and **Client Secret**

### 4. Configure environment
```bash
cp .env.example .env
nano .env
```

Fill in:
```env
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=make_this_a_random_32_char_string
BOT_OWNER_ID=your_discord_user_id
PORT=3000
```

### 5. Run the server
```bash
node server.js
```

### 6. Access the web app
- On your phone: open browser → `http://localhost:3000`
- On another device on same WiFi: `http://YOUR_PHONE_IP:3000`
- For public internet: use **Cloudflare Tunnel** or **ngrok**

---

## CBScript Language

CBScript is a tag-based language inspired by BDFD. Example:

```cbscript
<nif sendMessage{Hello, welcome to the server!}
<nif createEmbed
<nif title{Welcome}
<nif description{Thanks for joining!}
<nif color{#00ff00}
<nif addField{Rules, Be nice, false}
<nif addTimestamp
```

### Triggers
- `message` — Any message
- `message:hello` — Exact match "hello"
- `command:!help` — Starts with "!help"
- `startsWith:!` — Starts with "!"
- `contains:hi` — Contains "hi"
- `join` — Member joins server
- `ready` — Bot comes online

### Console / Logging
- `<nif consolePrint{Hello World!}` — Print to the bot's console (visible in Console tab)
- `<nif print{Something happened}` — Alias for consolePrint

### Variables
- `<nif setVar{coins, 100}` — Set global var
- `<nif getVar{coins}` — Get global var
- `<nif addVar{coins, 50}` — Add to var
- `<nif setUserVar{level, 5, $authorID}` — Per-user var

### Conditions
```cbscript
<nif if{$message==hello}
  <nif sendMessage{Hi there!}
<nif elseif{$message==bye}
  <nif sendMessage{Goodbye!}
<nif else
  <nif sendMessage{I don't understand}
<nif endif
```

### Full Command Reference
See `CBScript_Language_Specification.txt` for all available commands.

---

## JavaScript & Python

- **JavaScript**: Write raw discord.js code. Full access to `ctx` object.
- **Python**: Code editor supported but execution requires Python installed. Add `child_process` execution in `bot-manager.js` if needed.

---

## Hosting System

Bots do NOT run forever for free. Each bot needs hosting credits:
- Click **"Watch Ad for 1 Day Hosting"** on Dashboard
- Wait 5 seconds (simulated ad)
- Get +24 hours of hosting
- Bot will auto-stop when hosting expires

This prevents abuse and keeps your phone from melting.

---

## Data Storage

Uses JSON file database (`data/db.json`). No SQLite compilation needed. Works on any Termux setup.

---

## Keeping Bot Online 24/7 on Phone

1. **Disable battery optimization** for Termux
2. **Acquire wakelock**: `termux-wake-lock`
3. **Use tmux** to keep session alive:
   ```bash
   pkg install tmux
   tmux new -s cbscript
   node server.js
   # Press Ctrl+B then D to detach
   # tmux attach -t cbscript  # to reattach
   ```
4. **Cloudflare Tunnel** for public access:
   ```bash
   pkg install cloudflared
   cloudflared tunnel --url http://localhost:3000
   ```

---

## Security Notes

- Bot tokens are stored in plain text in `data/db.json`. This is a self-hosted platform.
- Keep your `.env` file secret.
- Do NOT expose this to the public internet without HTTPS (use Cloudflare Tunnel for HTTPS).

---

## File Structure

```
cbscript-platform/
├── server.js              # Express API + OAuth
├── database.js            # JSON file DB
├── cbscript-compiler.js   # CBScript → JS transpiler
├── bot-manager.js         # Discord.js client manager
├── package.json
├── .env.example
├── public/
│   ├── index.html         # SPA shell
│   ├── style.css          # iOS 18 rounded UI
│   └── app.js             # Frontend logic
└── data/
    └── db.json            # Auto-created database
```

---

## License

MIT — Use at your own risk. Not affiliated with Discord or BDFD.
