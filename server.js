import express from "express";
import sqlite3 from "sqlite3";
import cron from "node-cron";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
app.use(express.json());

// --- SQLite setup ---
const DB_PATH = "./counter.db";
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER)");
  db.get("SELECT * FROM counter WHERE id = 1", (err, row) => {
    if (err) {
      console.error("❌ Error checking counter table:", err);
    } else if (!row) {
      db.run("INSERT INTO counter (id, value) VALUES (1, 0)");
      console.log("✅ Initialized counter table");
    } else {
      console.log("✅ Counter table already initialized");
    }
  });
});

// --- Express API routes ---
app.get("/count", (req, res) => {
  db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ count: row.value });
  });
});

app.post("/update", (req, res) => {
  const delta = req.body.delta;
  db.run("UPDATE counter SET value = value + ? WHERE id = 1", [delta], err => {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
      if (!err && row) broadcastCount(row.value);
    });

    res.json({ ok: true });
  });
});

// --- Daily reset at 11 PM IST ---
cron.schedule("0 23 * * *", () => {
  console.log("🕚 Resetting counter at 11PM IST");
  db.run("UPDATE counter SET value = 0 WHERE id = 1", err => {
    if (!err) broadcastCount(0);
  });
}, {
  timezone: "Asia/Kolkata"
});

// --- Serve frontend ---
app.get("/", (req, res) => {
  res.send(`
<html>
  <head>
    <title>🌟 Shared Counter</title>
    <style>
      /* Full-screen flex centering */
      body, html {
        height: 100%;
        margin: 0;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: #f5f5f5;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .container {
        text-align: center;
      }

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
        gap: 60px; /* space between buttons */
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

      .btn.increment {
        background-color: #4CAF50;
      }
      .btn.increment:hover {
        background-color: #45a049;
        transform: scale(1.05);
      }

      .btn.decrement {
        background-color: #f44336;
      }
      .btn.decrement:hover {
        background-color: #e53935;
        transform: scale(1.05);
      }

      #status {
        font-size: 20px;
        color: gray;
      }
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

      // --- WebSocket setup ---
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(protocol + '//' + window.location.host);

      
      ws.onopen = () => statusEl.textContent = "Live 🔴";
      ws.onclose = () => statusEl.textContent = "Disconnected ⚪";
      ws.onerror = () => statusEl.textContent = "Error ⚠️";

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'counter') {
          countEl.textContent = msg.value;
        }
      };

      fetchCount();
    </script>
  </body>
</html>

  `);
});

// --- HTTP + WebSocket combined server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcastCount(value) {
  const payload = JSON.stringify({ type: "countUpdate", value });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on("connection", (ws) => {
  db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
    if (!err && row)
      ws.send(JSON.stringify({ type: "countUpdate", value: row.value }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
