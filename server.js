import express from "express";
import cron from "node-cron";
import { WebSocketServer } from "ws";
import http from "http";
import Database from "@replit/database";

const db = new Database();
const app = express();
app.use(express.json());

// --- Initialize counter ---
async function initCount() {
  let count = await db.get("count");
  if (count === null) {
    await db.set("count", 0);
    console.log("✅ Initialized count = 0");
  } else {
    console.log(`✅ Loaded count = ${count}`);
  }
}
await initCount();

async function getCount() {
  return (await db.get("count")) ?? 0;
}

async function updateCount(newValue) {
  await db.set("count", newValue);
}

// --- WebSocket setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

async function broadcastCount() {
  const value = await getCount();
  const msg = JSON.stringify({ type: "counter", value });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on("connection", async (ws) => {
  const value = await getCount();
  ws.send(JSON.stringify({ type: "counter", value }));
});

// --- API routes ---
app.get("/count", async (req, res) => {
  const value = await getCount();
  res.json({ value });
});

app.post("/increment", async (req, res) => {
  let value = await getCount();
  value++;
  await updateCount(value);
  broadcastCount();
  res.json({ value });
});

app.post("/decrement", async (req, res) => {
  let value = await getCount();
  value--;
  await updateCount(value);
  broadcastCount();
  res.json({ value });
});

// --- Daily reset at 11 PM IST ---
cron.schedule(
  "0 23 * * *",
  async () => {
    console.log("🕚 Resetting counter at 11PM IST");
    await updateCount(0);
    broadcastCount();
  },
  { timezone: "Asia/Kolkata" }
);

// --- Frontend ---
app.get("/", (req, res) => {
  res.send(`
<html>
  <head>
    <title>🌟 Shared Counter</title>
    <style>
      body, html {
        height: 100%;
        margin: 0;
        font-family: 'Segoe UI', sans-serif;
        background-color: #f5f5f5;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .container { text-align: center; }
      h1#title { font-size: 48px; color: #333; margin-bottom: 40px; }
      h1#count { font-size: 120px; margin-bottom: 50px; color: #222; }
      .buttons { display: flex; justify-content: center; gap: 60px; margin-bottom: 30px; }
      .btn {
        font-size: 60px;
        width: 120px;
        height: 120px;
        border-radius: 50%;
        border: none;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        cursor: pointer;
        color: white;
      }
      .btn.increment { background-color: #4CAF50; }
      .btn.decrement { background-color: #f44336; }
      #status { font-size: 20px; color: gray; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 id="title">🌟 SAH LIVE OP COUNTER 🌟</h1>
      <h1 id="count">0</h1>
      <div class="buttons">
        <button class="btn decrement" onclick="updateCount(-1)">−</button>
        <button class="btn increment" onclick="updateCount(1)">+</button>
      </div>
      <div id="status">Connecting...</div>
    </div>
    <script>
      const countEl = document.getElementById('count');
      const statusEl = document.getElementById('status');

      async function fetchCount() {
        const res = await fetch('/count');
        const data = await res.json();
        countEl.textContent = data.value;
      }

      async function updateCount(delta) {
        const url = delta > 0 ? '/increment' : '/decrement';
        await fetch(url, { method: 'POST' });
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(protocol + '//' + window.location.host);

      ws.onopen = () => statusEl.textContent = "Live 🔴";
      ws.onclose = () => statusEl.textContent = "Disconnected ⚪";
      ws.onerror = () => statusEl.textContent = "Error ⚠️";

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'counter') countEl.textContent = msg.value;
      };

      fetchCount();
    </script>
  </body>
</html>
  `);
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
