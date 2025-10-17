import express from "express";
// Node 18+ already includes global fetch — no import needed
import cron from "node-cron";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
app.use(express.json());

// --- JSONBin setup ---
const BIN_ID = process.env.BIN_ID;
const API_KEY = process.env.API_KEY;
const BASE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

async function getCount() {
  const res = await fetch(BASE_URL, { headers: { "X-Master-Key": API_KEY } });
  const data = await res.json();
  return data.record.count;
}

async function updateCount(newCount) {
  await fetch(BASE_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": API_KEY,
    },
    body: JSON.stringify({ count: newCount }),
  });
}

// --- WebSocket setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

async function broadcastCount() {
  const count = await getCount();
  const msg = JSON.stringify({ type: "counter", value: count });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on("connection", async (ws) => {
  const count = await getCount();
  ws.send(JSON.stringify({ type: "counter", value: count }));
});

// --- API routes ---
app.get("/count", async (req, res) => {
  const count = await getCount();
  res.json({ value: count });
});

app.post("/increment", async (req, res) => {
  let count = await getCount();
  count++;
  await updateCount(count);
  broadcastCount();
  res.json({ value: count });
});

app.post("/decrement", async (req, res) => {
  let count = await getCount();
  count--;
  await updateCount(count);
  broadcastCount();
  res.json({ value: count });
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

// --- Serve frontend ---
app.get("/", (req, res) => {
  res.send(`
<html>
  <head>
    <title>🌟 Shared Counter</title>
    <style>
      body, html {
        height: 100%;
        margin: 0;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: #f5f5f5;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .container { text-align: center; }

      h1#title {
        font-size: 48px;
        margin-bottom: 40px;
        color: #333;
      }

      h1#count {
        font-size: 120px;       
        margin-bottom: 50px;
        color: #222;
      }

      .buttons {
        display: flex;
        justify-content: center;
        gap: 60px;
        margin-bottom: 30px;
      }

      .btn {
        font-size: 60px;        
        width: 120px;
        height: 120px;
        border-radius: 50%;
        border: none;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: transform 0.1s, background-color 0.2s;
        color: white;
      }

      .btn.increment { background-color: #4CAF50; }
      .btn.increment:hover { background-color: #45a049; transform: scale(1.05); }

      .btn.decrement { background-color: #f44336; }
      .btn.decrement:hover { background-color: #e53935; transform: scale(1.05); }

      #status { font-size: 20px; color: gray; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 id="title">🌟 SAH LIVE OP COUNTER 🌟</h1>
      <h1 id="count">0</h1>
      <div class="buttons">
        <button class="btn decrement" onclick="updateCount(-1)">-</button>
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

      // WebSocket setup
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

// --- Self-ping to keep Render awake ---
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(`https://${process.env.RENDER_EXTERNAL_URL}`).catch(() => {});
    console.log("🔁 Self-ping to keep alive");
  }, 20 * 60 * 1000);
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
