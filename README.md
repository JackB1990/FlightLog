# FlightLog

A self-hosted personal flight log: flight cards, a great-circle route map, travel companions and detailed statistics.
One small container, one SQLite file, no external database.

* **Flights**: a search-results style list of flight cards (times, route, distance, class, companions) with filters for year, airline, cabin class and punctuality, plus Newest / Longest / Shortest sorting
* **Route map**: great-circle routes (antimeridian-safe), centred on your home country
* **Statistics**: six tabs (Airlines & Aircraft, Places, Flights and delays, Spend, People, Other). Flights and distance are shown side by side, a world map shades the countries you have visited, and punctuality, flight length, journey types, time away, connections, spend (from the cost you log) and aircraft registrations are all included. Distances follow your miles/km setting; departures are measured from your home country.
* **Add-a-flight form** with searchable airport, airline and aircraft drop-downs, date and time pickers, aircraft registration and the total price of the booking
* **Backup / restore** from Settings (single JSON file)
* **Accounts and a proper login page**: each person has their own username, password, home country and miles/kilometres preference, and sees only their own flights
* ~9,000 airports from OurAirports, added automatically when the image is built

---

## Trips and single flights

Use the **One way / Return** toggle when logging. A one-way flight is stored as a single flight; add connecting flights to a journey, or log the flights out and back for a return trip, and FlightLog groups them into one trip. Trips show as one card on the Flights page, with a details page listing every leg and the time between connections. Backups (Settings) include the trip grouping, and databases from earlier versions upgrade automatically.

## Walkthrough

### Step 1: Put the project on GitHub

1. Sign in at <https://github.com>, click **+ → New repository**.
   * Name: `flightlog`
   * Visibility: **Public** is simplest. Private works too, but see the note in Step 3.
   * Leave "Add a README" **unticked**. Click **Create repository**.
2. Upload the project. Pick **one** way:

   **A. Command line (recommended: it handles the hidden `.github` folder for you)**
   ```bash
   cd flightlog            # the unzipped project folder
   git init -b main
   git add .
   git commit -m "FlightLog"
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/flightlog.git
   git push -u origin main
   ```
   (GitHub will ask you to sign in; use a personal access token as the password if prompted.)

   **B. Browser upload**: on the empty repo page choose **uploading an existing file**, drag in *everything* from inside the project folder, then **Commit changes**.
   Make sure the hidden `.github` folder comes too (macOS Finder: press `Cmd + Shift + .` to show hidden files; Windows: it is visible by default). Without it, no image gets built.

### Step 2: Let GitHub build the image

1. Open the repo's **Actions** tab. The workflow **Test and publish image** starts by itself on every push to `main`.
2. Wait for both jobs (`test`, then `publish`) to turn green. The first run takes roughly 5-10 minutes.
3. If it fails, open the failing step and send me the log.

### Step 3: Make the image downloadable

GitHub packages start out private. On your GitHub profile click **Packages → flightlog → Package settings → Danger Zone → Change visibility → Public**.

> Keeping it private? In Portainer go to **Registries → Add registry → Custom**: URL `ghcr.io`, your GitHub username, and a personal access token with the `read:packages` scope.

### Step 4: Prepare TrueNAS (optional but tidy)

By default the database lives in a Docker volume called `flightlog-data`, and no preparation is needed.

If you would rather keep it in a dataset (so it is covered by your snapshots and backups):

1. **Datasets → Add Dataset**, e.g. `tank/apps/flightlog` (preset *Apps* or *Generic*).
2. **Edit Permissions** on it: user **apps**, group **apps** (both are ID **568**), tick *Apply User / Apply Group*, save.
3. You will use its path, e.g. `/mnt/tank/apps/flightlog`, in the next step as `FL_DATA`.

### Step 5: Deploy in Portainer

1. In Portainer choose your environment (usually **local**), then **Stacks → Add stack**.
2. Name: `flightlog`. Build method: **Web editor**.
3. Paste in the contents of `docker-compose.yml` and replace `YOUR_GITHUB_USERNAME` with your GitHub username in **lowercase**.
4. Scroll to **Environment variables → Add environment variable** and (recommended) add:

   | Name | Value | What it does |
   |------|-------|--------------|
   | `FL_PASSWORD` | something strong | Optional. Creates (or keeps) an account for `FL_USER` with this password. Not needed: you can create your account on the login page |
   | `FL_SIGNUPS` | `off` | Optional. Set to `off` after your accounts exist so nobody else can register |
   | `FL_PORT` | `8420` | Port on the NAS (change if it clashes) |
   | `FL_DATA` | `/mnt/tank/apps/flightlog` | Only if you made a dataset in Step 4 |

5. Click **Deploy the stack**.
6. Visit `http://YOUR-TRUENAS-IP:8420`. In Portainer, **Containers → flightlog** should show *healthy* after about 15 seconds.

FlightLog starts empty: no sample data is installed. On your first visit you will see the login page: choose **Create account**, pick a username and password, your **home country** and **miles or kilometres** (both can be changed later in **Settings**), then **Log a Flight**.

### Accounts

* Anyone who can reach the app can create an account while sign-ups are on (the default). Each account is completely separate. Once everyone who needs one has signed up, set `FL_SIGNUPS` to `off`.
* Sessions last 30 days and are stored in a cookie that scripts on the page cannot read. Repeated wrong passwords are slowed down automatically.
* There is no password-reset email. If you forget a password on a one-person install, set `FL_USER` and `FL_PASSWORD` in Portainer and redeploy: that account's password is reset to the value you set.

### Updating later

Push a change to `main` and wait for the green build, then in Portainer open the stack → **Editor** → switch on **Re-pull image and redeploy** → **Update the stack**. Your data is untouched.

**Upgrading from the version without accounts:** your flights and companions are kept. If you had set `FL_PASSWORD`, the same username (`FL_USER`, default `flightlog`) and password now work on the new login page and that account owns your existing flights. If you had no password, the first account created on the login page takes over your existing flights, so create it yourself straight after updating.

### Backups

* **Settings → Backup & Restore → Download export** gives one JSON file with everything.
* Or snapshot/copy the dataset (or volume): the whole database is one file, `flightlog.db`.
* To restore: **Settings → Import file**. Tick *Replace existing flights* to wipe first.

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `FL_PASSWORD` | *(empty)* | Optional: makes sure an account named `FL_USER` exists with this password |
| `FL_USER` | `flightlog` | Username used with `FL_PASSWORD` |
| `FL_SIGNUPS` | `on` | `off` stops new accounts being created (the first account is always allowed) |
| `PORT` | `3000` | Port **inside** the container (leave alone) |
| `DATA_DIR` | `/data` | Where `flightlog.db` is stored |
| `TZ` | `Europe/London` | Container time zone |

Passwords sent over plain `http://` can be read by anyone on your network. That is fine for a home LAN. For access from outside, put it behind a reverse proxy with HTTPS (forward the `X-Forwarded-Proto` header so the login cookie is marked secure) (Nginx Proxy Manager, Caddy, Cloudflare Tunnel). The app uses relative URLs, so it also works under a sub-path.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pull access denied` / `denied` when deploying | Package is still private (Step 3), or the username in the YAML is wrong / not lowercase |
| Container restarts with `EACCES` / `unable to open database file` | The `FL_DATA` folder is not owned by user/group 568 (Step 4) |
| `port is already allocated` | Set a different `FL_PORT` |
| Airport search finds only ~150 airports | The full dataset is missing from the image: check the **Actions** build log for the `curl` step |
| Airline logos blank | Logos are fetched from a public logo service and fall back to the airline name when offline |
| Portainer build error `mkdir /.docker: permission denied` | Only when using `docker-compose.build.yml`: Portainer's `HOME` is unset. Use the prebuilt-image YAML instead |
| Blank page | Hard-refresh (Ctrl/Cmd + Shift + R). The page itself prints a message if its libraries failed to load |

## Project layout

```
server/index.js        API + static file server (Node 22 built-in SQLite, zero npm dependencies)
shared/core.js         distance + statistics maths, shared by the server and the browser
frontend/              Alpine.js single-page UI (hash routes: #/, #/map, #/stats ...)
tools/                 airport CSV converter (used by the Docker build)
tests/                 node --test suites (run with `npm test`); tests/support holds the in-memory API the UI tests use
Dockerfile             two-stage build; fetches Alpine, Leaflet and OurAirports
docker-compose.yml     the file you paste into Portainer
.github/workflows/     test + build + publish to ghcr.io
```

Run the tests locally with `npm test` (Node 22.5 or newer). To try the container locally: `docker compose -f docker-compose.build.yml up --build`.

Airport data: [OurAirports](https://ourairports.com/data/) (public domain). Map tiles: © OpenStreetMap contributors.
