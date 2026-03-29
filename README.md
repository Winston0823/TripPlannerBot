# TripPlannerBot

An AI-powered group trip planning assistant that lives in your iMessage group chat. Add the bot to a group, tell it where you want to go, and it guides everyone through picking activities, voting on venues, building a day-by-day itinerary, and sharing booking links — all without leaving iMessage.

---

## What It Does

1. **Setup** — Someone starts a trip by telling the bot a destination and dates
2. **Preferences** — Everyone privately rates their pace, budget, and adventure level (1-5)
3. **Activity Types** — The bot researches and suggests activity categories. The group votes on their favorites
4. **Venues** — For each activity type, the bot finds real places with links and the group votes
5. **Day Assignment** — The bot builds a day-by-day plan based on votes, preferences, and logistics
6. **Logistics** — Travel times, parking, transport notes are auto-filled
7. **Review** — The group reviews the itinerary and requests changes
8. **Booking** — The bot sends booking links for each venue

The bot handles voting (majority rules), ties (organizer decides), transport math (carpooling, rental car detection), and keeps individual preferences private.

---

## What You Need

- A **Mac** (the bot runs on macOS because it needs access to iMessage)
- **Node.js** 18 or newer — [download here](https://nodejs.org)
- A **Minimax API key** — this powers the AI brain ([sign up](https://www.minimax.io))
- A **Google API key** — this powers venue/flight research via Gemini ([get one](https://ai.google.dev))
- **Xcode** (only if you want to build the iOS extension or companion app)

### Optional

- **BlueBubbles** — enables advanced iMessage features like reactions and message effects. [Download](https://bluebubbles.app). Requires disabling SIP (System Integrity Protection) on your Mac
- **ngrok** — makes your local API accessible from the internet so the iOS app can connect. [Sign up free](https://ngrok.com)

---

## Setup (Step by Step)

### 1. Download the project

```
git clone https://github.com/Winston0823/TripPlannerBot.git
cd TripPlannerBot
```

### 2. Install dependencies

```
npm install
```

### 3. Create your settings file

Create a file called `.env` in the project folder with your API keys:

```
MINIMAX_API_KEY=your-minimax-key-here
GOOGLE_API_KEY=your-google-api-key-here
```

If you're using BlueBubbles, also add:

```
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_API_KEY=your-bluebubbles-password
```

### 4. Start the bot

```
node imessageAgent.js
```

You should see:

```
Database initialized.
iMessage AI Agent started...
API server running on http://localhost:3001
```

### 5. Use the bot

In any iMessage group chat, type `@shyt` followed by what you want to do:

- `@shyt let's plan a trip to Tokyo, April 10-15` — starts a new trip
- `@shyt 3,4,2` — submits your preferences (pace, budget, adventure)
- `@shyt 1` or `@shyt 2` — votes on a poll option
- `@shyt overview` — shows current trip status
- `@shyt continue` — moves to the next stage

The bot responds to natural language too — just talk to it like you would a person.

---

## Making It Accessible from the Internet (for the iOS App)

The companion iOS app needs to reach your Mac's API server. Use ngrok to create a public URL:

### 1. Install ngrok

```
npm install -g ngrok
```

### 2. Sign up and authenticate

Go to [ngrok.com/signup](https://dashboard.ngrok.com/signup), create a free account, then run:

```
ngrok config add-authtoken YOUR_TOKEN_HERE
```

(Find your token at [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken))

### 3. Start the tunnel

```
ngrok http 3001
```

You'll get a public URL like `https://something.ngrok-free.dev` — use this in the iOS app settings.

---

## BlueBubbles Setup (Optional — Advanced Features)

BlueBubbles lets the bot use iMessage's Private API for reactions, effects, and more.

### 1. Disable SIP

1. Shut down your Mac
2. Hold the power button until you see "Loading startup options"
3. Click **Options** > **Utilities** > **Terminal**
4. Type: `csrutil disable` and press Enter
5. Restart your Mac

### 2. Install BlueBubbles

1. Download from [bluebubbles.app](https://bluebubbles.app)
2. Open it and follow the setup wizard
3. In **Private API** settings, check **Messages Private API**
4. Note the local port (default: 1234) and your password

### 3. Add to your .env file

```
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_API_KEY=your-bluebubbles-password
```

---

## iOS Extension & Companion App

The project includes two iOS components in the `TripPlanner/` folder:

- **Messages Extension** — an iMessage app for voting and submitting preferences directly in the chat
- **TripPlannerCurator** — a standalone companion app with a trip dashboard, itinerary view, and vote details

To build these:

1. Open `TripPlanner/TripPlanner.xcodeproj` in Xcode
2. Select your team in Signing & Capabilities
3. Build and run on your device

The iOS app connects to the API server — if running locally, use ngrok to make it accessible (see above).

---

## Project Structure

```
TripPlannerBot/
  imessageAgent.js      -- Main bot: watches iMessage, calls AI, executes tools
  messageHandlers.js    -- Routes DMs and group messages
  database.js           -- SQLite database (trips, polls, votes, preferences, itinerary)
  tools.js              -- Gemini AI research + Apple Maps integration
  apiServer.js          -- REST API for the iOS extension and companion app
  extensionWatcher.js   -- Syncs votes from the iMessage extension
  .env                  -- Your API keys (don't share this file)
  trip_planner.db       -- Local database (auto-created on first run)
  TripPlanner/          -- iOS extension and companion app (Xcode project)
  tools/                -- Utility scripts
```

---

## Troubleshooting

**Bot doesn't respond to messages**
- Make sure `node imessageAgent.js` is running
- Check that you're using `@shyt` or `@bot` to trigger it in group chats
- The bot always responds in DMs without needing @

**Messages not sending to group chat**
- Make sure the Messages app is open on your Mac
- Check the terminal for error messages

**API timeout / bot hangs**
- The AI might be processing a complex request. Wait 30-45 seconds
- If it happens often, restart the bot with `Ctrl+C` then `node imessageAgent.js`

**"Database initialized" but nothing else**
- Check your `.env` file has valid API keys
- Make sure your Mac has internet access

**ngrok says "authentication failed"**
- Run `ngrok config add-authtoken YOUR_TOKEN` with your token from the ngrok dashboard

---

## API Endpoints

The server runs on port 3001 by default. Key endpoints:

| Endpoint | What it does |
|----------|-------------|
| `GET /health` | Check if the server is running |
| `POST /chat` | Send a message to the AI |
| `POST /trip/join` | Join a trip using a join code |
| `GET /participant/:id/active` | Get active trip for a participant |
| `GET /participant/:id/dashboard` | Get trip dashboard data |
| `GET /session/:id/preference-status` | Check who has submitted preferences |
| `POST /session/:id/preferences` | Submit preference scores |
| `GET /session/:id/vote/:voteId` | Get poll details |
| `POST /session/:id/vote/:voteId` | Cast a vote |
