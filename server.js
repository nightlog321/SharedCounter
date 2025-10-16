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
        <title>Shared Counter</title>
        <style>
          body { font-family: sans-serif; text-align: center; margin-top: 100px; background: #fafafa; }
          h1 { font-size: 72px; margin-bottom: 30px; }
          button { font-size: 36px; margin: 10px; width: 80px; height: 80px; border-radius: 50%; border: none; box-shadow: 0 2px 5px rgba(0,0,0,0.2); cursor: pointer; }
          button:hover { background: #eee; }
          #status { margin-top: 20px; font-size: 18px; color: gray; }
        </style>
      </head>
      <body>
        <h1 id="count">0</h1>
        <button onclick="updateCount(1)">+</button>
        <button onclick="updateCount(-1)">−</button>
        <div id="status">Connecting...</div>
        <script>
          const countEl = document.getElementById('count');
          const statusEl = document.getElementById('status');

          async function fetchCount() {
            const res = await fetch('/count');
            const data = await res.json();
            countEl.textContent = data.count;
          }

          async function updateCount(delta) {
            await fetch('/update', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ delta })
            });
          }

          // --- WebSocket setup ---
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);

          ws.onopen = () => statusEl.textContent = "Live 🔴";
          ws.onclose = () => statusEl.textContent = "Disconnected ⚪";
          ws.onerror = () => statusEl.textContent = "Error ⚠️";

          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'countUpdate') {
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
