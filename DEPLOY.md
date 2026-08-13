# Deploying SIX SIDES to a VPS

One Node process serves everything: static client files + the WebSocket game server, on **port 8080**.

## Requirements

- Node 20+ and npm on the VPS
- ~1 vCPU is enough for a full 50-slot match (measured tick cost ~9 ms of the 16.7 ms budget at 50 combatants); 2 vCPUs gives comfortable headroom
- ~200 MB RAM for the process (measured ~26 MB heap steady-state + Node overhead)
- The Kenney/Quaternius asset packs in the repo layout `npm run assets` expects (they are git-ignored — copy them to the VPS once, or run `npm run assets` on a machine that has them and rsync `client/public/assets/` up)

## First deploy

```bash
git clone https://github.com/watchmedash/dashsyete.git
cd dashsyete
npm ci
npm run assets        # or rsync a prebuilt client/public/assets/ here
npm run start         # builds client/dist, then serves + game on :8080
```

Open `http://<vps-ip>:8080` — done. Player capacity: **20 humans**, bots fill the remaining 30 slots automatically (solo players always get a full 50-slot match).

## Keep it running (systemd)

`/etc/systemd/system/sixsides.service`:

```ini
[Unit]
Description=SIX SIDES game server
After=network.target

[Service]
WorkingDirectory=/opt/dashsyete
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sixsides
```

## Updating

```bash
cd /opt/dashsyete && git pull && npm ci && sudo systemctl restart sixsides
```

The stale-tab guard handles connected players: the server's build hash rides `welcome.v`, so clients on an old build auto-reload once and rejoin seamlessly.

## Notes

- **Persistence**: all-time scores live in `data/players.json` (created automatically, git-ignored). Back it up if you care about the leaderboard. Accounts are keyless — an online name collision just auto-suffixes a number.
- **Firewall**: open TCP 8080 (or reverse-proxy 80/443 → 8080 with nginx/caddy; WebSocket upgrade must be forwarded — with caddy, `reverse_proxy localhost:8080` handles it out of the box, and you get HTTPS for free).
- **Leaderboard API**: `GET /api/leaderboard` returns the all-time top scores as JSON (CORS-open).
- The client is fully static after build — every player downloads assets from your VPS on first load (~asset-pack sized; cached after).
- Everyone on the same server shares one world: block edits, craters, and the face-regeneration economy are global and live only in memory (world resets on restart by design).
