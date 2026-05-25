const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const BASELINE_FILE = path.join(DATA_DIR, "deepseek-baseline.json");

loadEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

let previousCpu = readCpuSnapshot();

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readCpuSnapshot() {
  const cpus = os.cpus();
  const totals = cpus.map((cpu) => {
    const idle = cpu.times.idle;
    const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
    return { idle, total };
  });
  return { cpus: totals, at: Date.now() };
}

function getCpuUsage() {
  const current = readCpuSnapshot();
  const values = current.cpus.map((cpu, index) => {
    const previous = previousCpu.cpus[index] || cpu;
    const idleDelta = cpu.idle - previous.idle;
    const totalDelta = cpu.total - previous.total;
    return totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
  });
  previousCpu = current;
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return {
    percent: clampPercent(average * 100),
    cores: values.map((value) => clampPercent(value * 100)),
    model: os.cpus()[0]?.model || "Unknown CPU"
  };
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    free,
    percent: clampPercent((used / total) * 100)
  };
}

async function getDriveUsage() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      "$d=[System.IO.DriveInfo]::new('C'); [pscustomobject]@{Size=$d.TotalSize;FreeSpace=$d.AvailableFreeSpace} | ConvertTo-Json -Compress"
    ]);
    const disk = JSON.parse(stdout.trim() || "{}");
    const total = Number(disk.Size || 0);
    const free = Number(disk.FreeSpace || 0);
    const used = Math.max(total - free, 0);
    return getDriveShape("C:", total, used, free);
  }

  const { stdout } = await execFileAsync("df", ["-k", "/"]);
  const [, line] = stdout.trim().split(/\r?\n/);
  const parts = line.trim().split(/\s+/);
  const total = Number(parts[1]) * 1024;
  const used = Number(parts[2]) * 1024;
  const free = Number(parts[3]) * 1024;
  return getDriveShape("/", total, used, free);
}

async function getDeepSeekBalance() {
  if (!DEEPSEEK_API_KEY) {
    return { ok: false, status: 0, message: "DEEPSEEK_API_KEY is not configured.", data: null };
  }

  try {
    const response = await fetch("https://api.deepseek.com/user/balance", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      }
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "ok" : `DeepSeek returned ${response.status}`,
      data
    };
  } catch (error) {
    return { ok: false, status: 0, message: error.message, data: null };
  }
}

async function getMetrics() {
  const [drive, deepseek] = await Promise.all([getDriveUsage(), getDeepSeekSnapshot()]);
  return {
    at: new Date().toISOString(),
    host: {
      name: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptime: os.uptime()
    },
    cpu: getCpuUsage(),
    memory: getMemoryUsage(),
    drive,
    deepseek
  };
}

function getSystemMetrics() {
  return {
    at: new Date().toISOString(),
    host: {
      name: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptime: os.uptime()
    },
    cpu: getCpuUsage(),
    memory: getMemoryUsage()
  };
}

async function getDriveSnapshot() {
  return {
    at: new Date().toISOString(),
    drive: await getDriveUsage()
  };
}

async function getDeepSeekSnapshot() {
  const balance = await getDeepSeekBalance();
  return {
    at: new Date().toISOString(),
    key_mask: maskKey(DEEPSEEK_API_KEY),
    balance,
    daily: getDeepSeekDaily(balance)
  };
}

function getDeepSeekDaily(balance) {
  if (!balance.ok || !balance.data) {
    return { date: localDate(), baseline_at: null, items: [] };
  }

  const today = localDate();
  const current = balanceToMap(balance.data.balance_infos || []);
  let baseline = readBaseline();
  if (baseline.date !== today) {
    baseline = {
      date: today,
      baseline_at: new Date().toISOString(),
      balances: current
    };
    writeBaseline(baseline);
  }

  const currencies = Array.from(new Set([...Object.keys(baseline.balances || {}), ...Object.keys(current)]));
  return {
    date: baseline.date,
    baseline_at: baseline.baseline_at,
    items: currencies.map((currency) => {
      const initial = Number(baseline.balances?.[currency] || 0);
      const now = Number(current[currency] || 0);
      return {
        currency,
        initial: roundMoney(initial),
        current: roundMoney(now),
        used: roundMoney(initial - now)
      };
    })
  };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { date: null, baseline_at: null, balances: {} };
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    return { date: null, baseline_at: null, balances: {} };
  }
}

function writeBaseline(baseline) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
}

function balanceToMap(infos) {
  const map = {};
  for (const item of infos) {
    map[item.currency] = Number(item.total_balance || 0);
  }
  return map;
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": MIME[".json"],
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function getDriveShape(label, total, used, free) {
  return {
    label,
    total,
    used,
    free,
    used_percent: total ? clampPercent((used / total) * 100) : 0,
    free_percent: total ? clampPercent((free / total) * 100) : 0
  };
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundMoney(value) {
  return Number(value.toFixed(4));
}

function maskKey(key) {
  if (!key) return "not configured";
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/metrics") {
      sendJson(response, 200, await getMetrics());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/system") {
      sendJson(response, 200, getSystemMetrics());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/drive") {
      sendJson(response, 200, await getDriveSnapshot());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/deepseek") {
      sendJson(response, 200, await getDeepSeekSnapshot());
      return;
    }
    if (request.method === "GET") {
      sendStatic(request, response);
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
