require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const ADMIN_KEYWORD = process.env.ADMIN_KEYWORD || 'I AM ADMIN';
const LOG_FILE = path.join(__dirname, 'logs.json');
const ADMIN_FILE = path.join(__dirname, 'admins.json');
const MESSAGE_FILE = path.join(__dirname, 'messages.json');
const WOUND_FILE = path.join(__dirname, 'wounds.json');
const MAX_LOGS = 1000;
const MAX_ADMINS = 1000;
const MAX_MESSAGES = 3000;
const MAX_WOUNDS = 1000;

function ensureJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
}

function readJsonArray(filePath, label) {
  try {
    ensureJsonFile(filePath);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Unable to read ${label}:`, error.message);
    return [];
  }
}

function writeJsonArray(filePath, rows, maxItems) {
  const trimmedRows = Array.isArray(rows) ? rows.slice(0, maxItems) : [];
  fs.writeFileSync(filePath, JSON.stringify(trimmedRows, null, 2), 'utf8');
}

function readLogs() {
  return readJsonArray(LOG_FILE, 'logs.json');
}

function writeLogs(logs) {
  writeJsonArray(LOG_FILE, logs, MAX_LOGS);
}

function readAdmins() {
  return sortAdmins(readJsonArray(ADMIN_FILE, 'admins.json'));
}

function writeAdmins(admins) {
  writeJsonArray(ADMIN_FILE, sortAdmins(admins), MAX_ADMINS);
}

function readMessages() {
  return readJsonArray(MESSAGE_FILE, 'messages.json');
}

function writeMessages(messages) {
  writeJsonArray(MESSAGE_FILE, messages, MAX_MESSAGES);
}

function readWounds() {
  return sortWounds(readJsonArray(WOUND_FILE, 'wounds.json'));
}

function writeWounds(wounds) {
  writeJsonArray(WOUND_FILE, sortWounds(wounds), MAX_WOUNDS);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function normalizeGroupName(groupName) {
  return String(groupName || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAdmin(admin) {
  const groupName = admin.groupName || '';
  const priority = Number(admin.priority) > 0 ? Number(admin.priority) : 1;

  return {
    ...admin,
    groupName,
    groupKey: admin.groupKey || normalizeGroupName(groupName),
    priority
  };
}

function sortAdmins(admins) {
  return [...admins].map(normalizeAdmin).sort((adminA, adminB) => {
    const groupCompare = adminA.groupKey.localeCompare(adminB.groupKey);
    if (groupCompare !== 0) return groupCompare;

    const priorityCompare = adminA.priority - adminB.priority;
    if (priorityCompare !== 0) return priorityCompare;

    return (adminB.timestamp || 0) - (adminA.timestamp || 0);
  });
}

function sortWounds(wounds) {
  return [...wounds].sort((woundA, woundB) => {
    if (woundA.status !== woundB.status) {
      return woundA.status === 'active' ? -1 : 1;
    }

    return (woundB.openedTimestamp || 0) - (woundA.openedTimestamp || 0);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAdminCommand(message) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(ADMIN_KEYWORD)}\\s*:\\s*(.+?)\\s*$`, 'i');
  const match = String(message || '').match(pattern);
  if (!match) return null;

  const groupName = match[1].trim();
  if (!groupName) return null;

  // A trailing number marks the admin priority: "Group1" or "Group 1".
  const priorityMatch = groupName.match(/^(.*?)(?:\s*([1-9]\d*))$/);
  const baseGroupName = priorityMatch && priorityMatch[1].trim() ? priorityMatch[1].trim() : groupName;
  const priority = priorityMatch ? Number(priorityMatch[2]) : 1;

  return {
    groupName: baseGroupName,
    groupKey: normalizeGroupName(baseGroupName),
    rawGroupName: groupName,
    priority
  };
}

const ACCEPT_KEYWORDS = ['ต', 'ติด', 'ครับ', 'เค', 'จ้า'];
const TRADE_KEYWORDS = [
  { keyword: '+5ซล', side: 'chang_dai' },
  { keyword: '+5ล', side: 'chang_dai' },
  { keyword: 'ซล', side: 'chang_dai' },
  { keyword: 'ไล่', side: 'chang_dai' },
  { keyword: 'ล', side: 'chang_dai' },
  { keyword: '+5ซย', side: 'chang_yang' },
  { keyword: '+5ซถ', side: 'chang_yang' },
  { keyword: '+5ย', side: 'chang_yang' },
  { keyword: '+5ถ', side: 'chang_yang' },
  { keyword: 'ถ.ยัง', side: 'chang_yang' },
  { keyword: 'ซย', side: 'chang_yang' },
  { keyword: 'ซถ', side: 'chang_yang' },
  { keyword: 'ถอย', side: 'chang_yang' },
  { keyword: 'ย', side: 'chang_yang' }
].sort((a, b) => b.keyword.length - a.keyword.length);

function normalizeMessageText(message) {
  return String(message || '').trim().replace(/\s+/g, ' ');
}

function parseTradeMessage(message) {
  const text = normalizeMessageText(message);
  if (!text) return null;

  for (const item of TRADE_KEYWORDS) {
    const pattern = new RegExp(`^${escapeRegExp(item.keyword)}\\s*(\\d*)$`, 'i');
    const match = text.match(pattern);

    if (match) {
      return {
        side: item.side,
        keyword: item.keyword,
        amount: match[1] || '',
        rawText: text
      };
    }
  }

  const compactText = text.replace(/\s+/g, '');
  const priceMatch = compactText.match(/^\d+(?:-\d+)*[a-z]\d+$/i);
  if (priceMatch) {
    return {
      side: 'custom_price',
      keyword: 'open_price',
      amount: '',
      rawText: text
    };
  }

  return null;
}

function parseAcceptMessage(message) {
  const text = normalizeMessageText(message);
  return ACCEPT_KEYWORDS.includes(text) ? text : null;
}

function parseResultCommand(message) {
  const match = normalizeMessageText(message).match(/^แจ้งผล\s*(\d+)$/i);
  return match ? match[1] : null;
}

function verifyLineSignature(req, res, next) {
  // Skip signature verification when the secret is not set for local testing.
  if (!LINE_CHANNEL_SECRET) {
    return next();
  }

  const signature = req.get('x-line-signature');
  if (!signature) {
    return res.sendStatus(401);
  }

  const expectedSignature = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(req.body)
    .digest('base64');

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.sendStatus(401);
  }

  return next();
}

function getMessageText(event) {
  if (!event.message) return '';

  if (event.message.type === 'text') {
    return event.message.text || '';
  }

  return event.message.type || '';
}

function createLogEntry(event) {
  const source = event.source || {};

  return {
    eventType: event.type || '',
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    message: getMessageText(event),
    timestamp: event.timestamp || null,
    time: formatDate(event.timestamp)
  };
}

function upsertAdminFromEvent(event) {
  const source = event.source || {};
  const message = getMessageText(event);
  const adminCommand = parseAdminCommand(message);

  if (!adminCommand || source.type !== 'user' || !source.userId) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  const admins = readAdmins().filter(
    (admin) => !(admin.groupKey === adminCommand.groupKey && admin.userId === source.userId)
  );
  const existingIndex = admins.findIndex(
    (admin) => admin.groupKey === adminCommand.groupKey && admin.priority === adminCommand.priority
  );
  const adminEntry = {
    groupName: adminCommand.groupName,
    groupKey: adminCommand.groupKey,
    rawGroupName: adminCommand.rawGroupName,
    priority: adminCommand.priority,
    userId: source.userId,
    adminKeyword: ADMIN_KEYWORD,
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp)
  };

  if (existingIndex >= 0) {
    admins[existingIndex] = {
      ...admins[existingIndex],
      ...adminEntry
    };
  } else {
    admins.unshift(adminEntry);
  }

  writeAdmins(admins);
  return adminEntry;
}

function isGroupTextMessage(event) {
  return event.type === 'message' && event.message?.type === 'text' && event.source?.type === 'group';
}

function trackGroupMessage(event) {
  if (!isGroupTextMessage(event) || !event.message.id) {
    return null;
  }

  const source = event.source || {};
  const messageText = getMessageText(event);
  const messageEntry = {
    id: event.message.id,
    groupId: source.groupId || '',
    userId: source.userId || '',
    text: messageText,
    trade: parseTradeMessage(messageText),
    timestamp: event.timestamp || Date.now(),
    time: formatDate(event.timestamp || Date.now())
  };
  const messages = readMessages().filter((message) => message.id !== messageEntry.id);

  writeMessages([messageEntry, ...messages]);
  return messageEntry;
}

function findTrackedMessage(messageId) {
  if (!messageId) return null;
  return readMessages().find((message) => message.id === messageId) || null;
}

function createWoundFromReply(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const acceptKeyword = parseAcceptMessage(getMessageText(event));
  const quotedMessage = findTrackedMessage(event.message.quotedMessageId);

  if (!acceptKeyword || !quotedMessage?.trade) return null;
  if (quotedMessage.groupId !== source.groupId) return null;
  if (!quotedMessage.userId || quotedMessage.userId === source.userId) return null;

  const nowTimestamp = event.timestamp || Date.now();
  const wounds = readWounds();
  const existingWound = wounds.find(
    (wound) =>
      wound.status === 'active' &&
      wound.groupId === source.groupId &&
      wound.openMessageId === quotedMessage.id &&
      wound.accepterUserId === source.userId
  );

  if (existingWound) {
    return existingWound;
  }

  const woundEntry = {
    id: `${source.groupId}:${quotedMessage.id}:${event.message.id || nowTimestamp}`,
    status: 'active',
    groupId: source.groupId || '',
    openerUserId: quotedMessage.userId,
    accepterUserId: source.userId || '',
    openMessageId: quotedMessage.id,
    acceptMessageId: event.message.id || '',
    openText: quotedMessage.text,
    acceptText: getMessageText(event),
    openKeyword: quotedMessage.trade.keyword,
    acceptKeyword,
    side: quotedMessage.trade.side,
    amount: quotedMessage.trade.amount,
    openedTimestamp: nowTimestamp,
    openedTime: formatDate(nowTimestamp),
    result: '',
    closedByUserId: '',
    closedTimestamp: null,
    closedTime: ''
  };

  writeWounds([woundEntry, ...wounds]);
  return woundEntry;
}

function isRegisteredAdmin(userId, groupId) {
  if (!userId) return false;

  return readAdmins().some((admin) => {
    if (admin.userId !== userId) return false;
    return !admin.groupId || admin.groupId === groupId;
  });
}

function closeGroupWounds(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const result = parseResultCommand(getMessageText(event));
  if (!result || !isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  let closedCount = 0;
  const wounds = readWounds().map((wound) => {
    if (wound.status !== 'active' || wound.groupId !== source.groupId) {
      return wound;
    }

    closedCount += 1;
    return {
      ...wound,
      status: 'closed',
      result,
      closedByUserId: source.userId || '',
      closedMessageId: event.message.id || '',
      closedTimestamp: nowTimestamp,
      closedTime: formatDate(nowTimestamp)
    };
  });

  if (closedCount > 0) {
    writeWounds(wounds);
  }

  return {
    result,
    closedCount
  };
}

ensureJsonFile(LOG_FILE);
ensureJsonFile(ADMIN_FILE);
ensureJsonFile(MESSAGE_FILE);
ensureJsonFile(WOUND_FILE);

// LINE signature verification needs the exact raw request body.
app.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '2mb' }),
  verifyLineSignature,
  (req, res) => {
    try {
      const bodyText = req.body ? req.body.toString('utf8') : '{}';
      const payload = bodyText ? JSON.parse(bodyText) : {};
      const events = Array.isArray(payload.events) ? payload.events : [];

      if (events.length > 0) {
        const newLogs = events.map((event) => {
          const logEntry = createLogEntry(event);
          const adminEntry = upsertAdminFromEvent(event);
          const closedWounds = closeGroupWounds(event);
          const woundEntry = createWoundFromReply(event);
          const trackedMessage = trackGroupMessage(event);

          if (adminEntry) {
            logEntry.adminRegistered = true;
            logEntry.adminGroupName = adminEntry.groupName;
            logEntry.adminPriority = adminEntry.priority;
          }

          if (closedWounds) {
            logEntry.woundsClosed = closedWounds.closedCount;
            logEntry.result = closedWounds.result;
          }

          if (woundEntry) {
            logEntry.woundCreated = true;
            logEntry.woundId = woundEntry.id;
          }

          if (trackedMessage?.trade) {
            logEntry.tradeKeyword = trackedMessage.trade.keyword;
            logEntry.tradeAmount = trackedMessage.trade.amount;
          }

          return logEntry;
        });
        const logs = readLogs();
        writeLogs([...newLogs, ...logs]);
      }
    } catch (error) {
      console.error('Webhook payload could not be processed:', error.message);
    }

    return res.sendStatus(200);
  }
);

app.use(express.json());

app.get('/', (req, res) => {
  const webhookUrl = `${req.protocol}://${req.get('host')}/webhook`;

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Logger</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 760px;
      margin: 48px auto;
      padding: 32px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin-top: 0;
      color: #111827;
    }
    code {
      display: block;
      padding: 14px;
      overflow-x: auto;
      background: #111827;
      color: #f9fafb;
      border-radius: 6px;
    }
    a {
      color: #047857;
      font-weight: 700;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <main>
    <h1>LINE Webhook Logger</h1>
    <p>Webhook URL</p>
    <code>${escapeHtml(webhookUrl)}</code>
    <div class="links">
      <a href="/logs">View Logs</a>
      <a href="/admins">Admins</a>
      <a href="/wounds">Wounds</a>
      <a href="/api/logs">JSON API</a>
      <a href="/webhook">Webhook Path</a>
    </div>
  </main>
</body>
</html>`);
});

app.get('/logs', (req, res) => {
  const logs = readLogs();
  const rows = logs
    .map(
      (log) => `<tr>
        <td>${escapeHtml(log.time)}</td>
        <td>${escapeHtml(log.eventType)}</td>
        <td>${escapeHtml(log.sourceType)}</td>
        <td>${escapeHtml(log.userId)}</td>
        <td>${escapeHtml(log.groupId)}</td>
        <td>${escapeHtml(log.roomId)}</td>
        <td>${escapeHtml(log.adminRegistered ? `${log.message} -> admin: ${log.adminGroupName} #${log.adminPriority}` : log.message)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Logs</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1180px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 920px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Webhook Logs</h1>
      <div class="actions">
        <a class="button" href="/logs">Refresh</a>
        <button class="danger" type="button" onclick="clearLogs()">Clear Logs</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>Event Type</th>
                  <th>Source Type</th>
                  <th>User ID</th>
                  <th>Group ID</th>
                  <th>Room ID</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No logs yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;

      const response = await fetch('/api/logs', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear logs.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/admins', (req, res) => {
  const admins = readAdmins();
  const rows = admins
    .map(
      (admin) => `<tr>
        <td>${escapeHtml(admin.time)}</td>
        <td>${escapeHtml(admin.groupName)}</td>
        <td>${escapeHtml(admin.priority)}</td>
        <td>${escapeHtml(admin.userId)}</td>
        <td>${escapeHtml(admin.adminKeyword)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Admins</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 980px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .hint {
      margin: 0 0 18px;
      color: #4b5563;
    }
    code {
      padding: 2px 6px;
      background: #e5e7eb;
      border-radius: 4px;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Admins</h1>
      <div class="actions">
        <a class="button" href="/admins">Refresh</a>
        <a class="button" href="/logs">Logs</a>
        <button class="danger" type="button" onclick="clearAdmins()">Clear Admins</button>
      </div>
    </div>
    <p class="hint">Private chat command: <code>${escapeHtml(ADMIN_KEYWORD)} : group name1</code>, <code>${escapeHtml(ADMIN_KEYWORD)} : group name2</code></p>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Group Name</th>
                  <th>Priority</th>
                  <th>User ID</th>
                  <th>Keyword</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No admins yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearAdmins() {
      if (!confirm('Clear all admins?')) return;

      const response = await fetch('/api/admins', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear admins.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/wounds', (req, res) => {
  const wounds = readWounds();
  const rows = wounds
    .map(
      (wound) => `<tr>
        <td>${escapeHtml(wound.status)}</td>
        <td>${escapeHtml(wound.openedTime)}</td>
        <td>${escapeHtml(wound.groupId)}</td>
        <td>${escapeHtml(wound.openerUserId)}</td>
        <td>${escapeHtml(wound.accepterUserId)}</td>
        <td>${escapeHtml(wound.openText)}</td>
        <td>${escapeHtml(wound.acceptText)}</td>
        <td>${escapeHtml(wound.result)}</td>
        <td>${escapeHtml(wound.closedByUserId)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Wounds</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1280px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .hint {
      margin: 0 0 18px;
      color: #4b5563;
    }
    code {
      padding: 2px 6px;
      background: #e5e7eb;
      border-radius: 4px;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1120px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Wounds</h1>
      <div class="actions">
        <a class="button" href="/wounds">Refresh</a>
        <a class="button" href="/logs">Logs</a>
        <a class="button" href="/admins">Admins</a>
        <button class="danger" type="button" onclick="clearWounds()">Clear Wounds</button>
      </div>
    </div>
    <p class="hint">Reply accept keywords: <code>${escapeHtml(ACCEPT_KEYWORDS.join(', '))}</code>. Admin close command: <code>แจ้งผล 50</code></p>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Group ID</th>
                  <th>Opener</th>
                  <th>Accepter</th>
                  <th>Open Message</th>
                  <th>Accept Message</th>
                  <th>Result</th>
                  <th>Closed By</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No wounds yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearWounds() {
      if (!confirm('Clear all wounds?')) return;

      const response = await fetch('/api/wounds', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear wounds.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/api/logs', (req, res) => {
  res.json(readLogs());
});

app.delete('/api/logs', (req, res) => {
  writeLogs([]);
  res.json({ success: true });
});

app.get('/api/admins', (req, res) => {
  res.json(readAdmins());
});

app.delete('/api/admins', (req, res) => {
  writeAdmins([]);
  res.json({ success: true });
});

app.get('/api/wounds', (req, res) => {
  res.json(readWounds());
});

app.delete('/api/wounds', (req, res) => {
  writeWounds([]);
  writeMessages([]);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`LINE Webhook Logger is running on port ${PORT}`);
});
