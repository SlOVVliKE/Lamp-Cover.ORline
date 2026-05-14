const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const test = require('node:test');

const SERVER_READY_TIMEOUT_MS = 30000;
const CREDIT_FILE = 'credits.json';
const WITHDRAWAL_FILE = 'withdrawals.json';
let nextPort = 3300 + Math.floor(Math.random() * 500);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(predicate, timeoutMs = 1000, intervalMs = 20) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(intervalMs);
  }
}

function createTestWithdrawalToken(userId, timestamp = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId, timestamp }), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', 'admin123')
    .update(payload)
    .digest('hex')
    .slice(0, 48);
  return `${payload}.${signature}`;
}

function createCreditsAdminUserToken(userId) {
  return crypto
    .createHmac('sha256', 'admin123')
    .update(`credit-user:${userId}`)
    .digest('hex')
    .slice(0, 40);
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch (error) {
      // Keep polling until the child process starts listening.
    }

    await delay(100);
  }

  throw new Error('Server did not start in time');
}

async function startHttpMock(handler) {
  const server = http.createServer(handler);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function startServer(envOverrides = {}) {
  const port = nextPort++;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ADMIN_API_AUTH_DISABLED: 'true',
      WITHDRAWAL_TIME_CHECK_DISABLED: 'true',
      LINE_CHANNEL_SECRET: '',
      LINE_OFFICIAL_ACCOUNT_URL: 'https://line.me/R/ti/p/@lamp-cover',
      ADMIN_KEYWORD: 'I AM ADMIN',
      MONGODB_URI: '',
      ...envOverrides
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${stderr}`);
  }

  return {
    baseUrl,
    async stop() {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  };
}

async function postWebhook(baseUrl, events) {
  const response = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events })
  });

  assert.equal(response.status, 200);
}

async function clearJson(baseUrl, path) {
  await fetch(`${baseUrl}${path}`, { method: 'DELETE' }).catch(() => {});
}

async function registerAndBindAdmin(baseUrl, groupId, userId = 'Uadmin', groupName = 'กลุ่มไทย') {
  await postWebhook(baseUrl, [
    {
      type: 'message',
      source: { type: 'user', userId },
      message: { type: 'text', id: `admin-${groupId}-${userId}`, text: `I AM ADMIN : ${groupName}1` },
      timestamp: 1710000000000
    },
    {
      type: 'message',
      source: { type: 'group', groupId, userId },
      message: { type: 'text', id: `bind-${groupId}-${userId}`, text: `ผูกกลุ่ม : ${groupName}` },
      timestamp: 1710000000001
    }
  ]);
}

function seedCredit(userId, amount, id, timestamp) {
  const credits = JSON.parse(fs.readFileSync(CREDIT_FILE, 'utf8'));
  const existing = credits.find((credit) => credit.userId === userId) || {
    userId,
    balance: 0,
    totalAdded: 0,
    transactions: []
  };
  const nextBalance = Number(existing.balance || 0) + amount;
  const transaction = {
    id: `${id}:test-seed`,
    type: 'test_credit_seed',
    amount,
    rawText: 'test credit seed',
    messageId: id,
    balanceAfter: nextBalance,
    timestamp,
    time: new Date(timestamp).toISOString()
  };
  const nextCredit = {
    ...existing,
    balance: nextBalance,
    totalAdded: Number(existing.totalAdded || 0) + amount,
    transactions: [transaction, ...(existing.transactions || [])],
    updatedTimestamp: timestamp,
    updatedTime: transaction.time
  };
  const nextCredits = [nextCredit, ...credits.filter((credit) => credit.userId !== userId)];

  fs.writeFileSync(CREDIT_FILE, JSON.stringify(nextCredits, null, 2), 'utf8');
}

function creditEvent(userId, amount, id, timestamp) {
  seedCredit(userId, amount, id, timestamp);

  return {
    type: 'message',
    source: { type: 'user', userId },
    message: { type: 'text', id, text: `seed credit ${amount}` },
    timestamp
  };
}

function confirmPairEvent(groupId, openerUserId, acceptMessageId, id, timestamp) {
  return {
    type: 'message',
    source: { type: 'group', groupId, userId: openerUserId },
    message: { type: 'text', id, quotedMessageId: acceptMessageId, text: 'ต' },
    timestamp
  };
}

function collectFlexTexts(value, texts = []) {
  if (!value || typeof value !== 'object') return texts;

  if (typeof value.text === 'string') {
    texts.push(value.text);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFlexTexts(item, texts);
    }
    return texts;
  }

  for (const item of Object.values(value)) {
    collectFlexTexts(item, texts);
  }

  return texts;
}

function collectFlexActions(value, actions = []) {
  if (!value || typeof value !== 'object') return actions;

  if (value.action && typeof value.action === 'object') {
    actions.push(value.action);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFlexActions(item, actions);
    }
    return actions;
  }

  for (const item of Object.values(value)) {
    collectFlexActions(item, actions);
  }

  return actions;
}

async function readRequestJson(req) {
  let rawBody = '';

  for await (const chunk of req) {
    rawBody += chunk.toString();
  }

  return rawBody ? JSON.parse(rawBody) : {};
}

test('creates an active wound after the opener confirms an accept reply', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'G1');

    await postWebhook(server.baseUrl, [
      creditEvent('Ubuyer', 5000, 'm-credit-buyer-1', 1710000000000),
      creditEvent('Useller', 5000, 'm-credit-seller-1', 1710000000000),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G1', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-round-open-1', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000000001
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G1', userId: 'Ubuyer' },
        message: { type: 'text', id: 'm-open-1', text: 'ชล1000' },
        timestamp: 1710000000000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G1', userId: 'Useller' },
        message: { type: 'text', id: 'm-accept-1', quotedMessageId: 'm-open-1', text: 'ต' },
        timestamp: 1710000001000
      },
      confirmPairEvent('G1', 'Ubuyer', 'm-accept-1', 'm-confirm-1', 1710000002000)
    ]);

    const response = await fetch(`${server.baseUrl}/api/wounds`);
    assert.equal(response.status, 200);

    const wounds = await response.json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].status, 'active');
    assert.equal(wounds[0].groupId, 'G1');
    assert.equal(wounds[0].openerUserId, 'Ubuyer');
    assert.equal(wounds[0].accepterUserId, 'Useller');
    assert.equal(wounds[0].amount, '1000');
    assert.equal(wounds[0].openKeyword, 'ชล');
    assert.equal(wounds[0].acceptKeyword, 'ต');
  } finally {
    await server.stop();
  }
});

test('uses readable bettor names in pair success cards instead of raw LINE user IDs', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    const openerUserId = 'U872e7a8e7fbb1c3e3f066d4c858b76f98';
    const accepterUserId = 'U111111111111111111111111111111111';

    await registerAndBindAdmin(server.baseUrl, 'Gnames');

    await postWebhook(server.baseUrl, [
      creditEvent(openerUserId, 10000, 'm-credit-named-opener', 1710000090000),
      creditEvent(accepterUserId, 10000, 'm-credit-named-accepter', 1710000090001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-named-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000091000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: openerUserId, displayName: 'AUI' },
        message: { type: 'text', id: 'm-named-trade', text: 'ชล3600' },
        timestamp: 1710000092000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: accepterUserId, displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-named-accept', quotedMessageId: 'm-named-trade', text: 'ต' },
        timestamp: 1710000093000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: openerUserId, displayName: 'AUI' },
        message: { type: 'text', id: 'm-named-confirm', quotedMessageId: 'm-named-accept', text: 'ต' },
        timestamp: 1710000094000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].openerDisplayName, 'AUI');
    assert.equal(wounds[0].accepterDisplayName, 'Bank Thirakan');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const woundLog = logs.find((log) => log.woundCreated);
    const texts = collectFlexTexts(woundLog.woundPrivateNotificationMessages).join('\n');

    assert.match(texts, /AUI/);
    assert.match(texts, /Bank Thirakan/);
    assert.match(texts, /ราคา 350-380/);
    assert.match(texts, /3,600\.00/);
    assert.match(texts, /ทีม/);
    assert.doesNotMatch(texts, /Order #/);
    assert.doesNotMatch(texts, /คุณทาย/);
    assert.doesNotMatch(texts, /คู่ทาย/);
    assert.doesNotMatch(texts, /^คู่$/m);
    assert.doesNotMatch(texts, new RegExp(openerUserId));
    assert.doesNotMatch(texts, new RegExp(accepterUserId));
  } finally {
    await server.stop();
  }
});

test('pair success cards include a cancel request button for active wounds', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcancel-button');

    await postWebhook(server.baseUrl, [
      creditEvent('UcancelOpen', 500, 'm-credit-cancel-open', 1710000101000),
      creditEvent('UcancelAccept', 500, 'm-credit-cancel-accept', 1710000101001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-button', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-cancel-button-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000102000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-button', userId: 'UcancelOpen', displayName: 'AIO' },
        message: { type: 'text', id: 'm-cancel-button-trade', text: 'ชล500' },
        timestamp: 1710000103000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-button', userId: 'UcancelAccept', displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-cancel-button-accept', quotedMessageId: 'm-cancel-button-trade', text: 'ต' },
        timestamp: 1710000104000
      },
      confirmPairEvent('Gcancel-button', 'UcancelOpen', 'm-cancel-button-accept', 'm-cancel-button-confirm', 1710000105000)
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const woundLog = logs.find((log) => log.woundCreated);
    const actions = collectFlexActions(woundLog.woundPrivateNotificationMessages);
    const cancelAction = actions.find((action) => action.label === 'แตะเพื่อยกเลิก');

    assert.equal(cancelAction.type, 'postback');
    assert.match(cancelAction.data, /action=wound_cancel_request/);
    assert.match(cancelAction.data, /woundId=/);
  } finally {
    await server.stop();
  }
});

test('pushes a pair success text before the private pair success card', async () => {
  const pushRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const body = await readRequestJson(req);
    if (req.url === '/v2/bot/message/push') {
      pushRequests.push(body);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gpair-push-text');

    await postWebhook(server.baseUrl, [
      creditEvent('UpairPushOpen', 500, 'm-credit-pair-push-open', 1710000105100),
      creditEvent('UpairPushAccept', 500, 'm-credit-pair-push-accept', 1710000105101),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-text', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-pair-push-round-open', text: 'เปิด ฟ้าสีทอง' },
        timestamp: 1710000105200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-text', userId: 'UpairPushOpen', displayName: 'ป๊อด ภาณุเดช' },
        message: { type: 'text', id: 'm-pair-push-trade', text: 'ชล20' },
        timestamp: 1710000105300
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-text', userId: 'UpairPushAccept', displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-pair-push-accept', quotedMessageId: 'm-pair-push-trade', text: 'ต' },
        timestamp: 1710000105400
      },
      confirmPairEvent('Gpair-push-text', 'UpairPushOpen', 'm-pair-push-accept', 'm-pair-push-confirm', 1710000105500)
    ]);

    assert.equal(pushRequests.length, 2);

    const requestsByTarget = new Map();
    for (const request of pushRequests) {
      const list = requestsByTarget.get(request.to) || [];
      list.push(request);
      requestsByTarget.set(request.to, list);
    }

    assert.equal(requestsByTarget.size, 2);
    for (const requests of requestsByTarget.values()) {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].messages.length, 2);
      assert.equal(requests[0].messages[0].type, 'text');
      assert.match(requests[0].messages[0].text, /จับคู่สำเร็จ/);
      assert.match(requests[0].messages[0].text, /20\.00/);
      assert.equal(requests[0].messages[1].type, 'flex');
      assert.match(requests[0].messages[1].altText, /จับคู่สำเร็จ/);
    }
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('keeps the pair success text sent when the private flex push fails', async () => {
  const pushRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const body = await readRequestJson(req);
    if (req.url === '/v2/bot/message/push') {
      pushRequests.push(body);
    }

    const hasFlex = (body.messages || []).some((message) => message.type === 'flex');
    res.writeHead(hasFlex ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hasFlex ? { message: 'invalid flex' } : { success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gpair-push-retry');

    await postWebhook(server.baseUrl, [
      creditEvent('UpairRetryOpen', 500, 'm-credit-pair-retry-open', 1710000105600),
      creditEvent('UpairRetryAccept', 500, 'm-credit-pair-retry-accept', 1710000105601),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-retry', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-pair-retry-round-open', text: 'เปิด ฟ้าสีทอง' },
        timestamp: 1710000105700
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-retry', userId: 'UpairRetryOpen', displayName: 'ป๊อด ภาณุเดช' },
        message: { type: 'text', id: 'm-pair-retry-trade', text: 'ชล20' },
        timestamp: 1710000105800
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpair-push-retry', userId: 'UpairRetryAccept', displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-pair-retry-accept', quotedMessageId: 'm-pair-retry-trade', text: 'ต' },
        timestamp: 1710000105900
      },
      confirmPairEvent('Gpair-push-retry', 'UpairRetryOpen', 'm-pair-retry-accept', 'm-pair-retry-confirm', 1710000106000)
    ]);

    const textRetryRequests = pushRequests.filter(
      (request) => request.messages?.length === 1 && request.messages[0].type === 'text'
    );

    assert.equal(textRetryRequests.length, 2);
    assert.equal(textRetryRequests[0].messages[0].text.includes('จับคู่สำเร็จ'), true);
    assert.equal(textRetryRequests[1].messages[0].text.includes('จับคู่สำเร็จ'), true);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('cancel request postback asks the paired opponent to approve or reject', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcancel-flow');

    await postWebhook(server.baseUrl, [
      creditEvent('UcancelRequester', 500, 'm-credit-cancel-requester', 1710000106000),
      creditEvent('UcancelOpponent', 500, 'm-credit-cancel-opponent', 1710000106001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-flow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-cancel-flow-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000107000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-flow', userId: 'UcancelRequester', displayName: 'AIO' },
        message: { type: 'text', id: 'm-cancel-flow-trade', text: 'ชล500' },
        timestamp: 1710000108000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcancel-flow', userId: 'UcancelOpponent', displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-cancel-flow-accept', quotedMessageId: 'm-cancel-flow-trade', text: 'ต' },
        timestamp: 1710000109000
      },
      confirmPairEvent('Gcancel-flow', 'UcancelRequester', 'm-cancel-flow-accept', 'm-cancel-flow-confirm', 1710000110000)
    ]);

    let wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    const woundId = wounds[0].id;

    await postWebhook(server.baseUrl, [
      {
        type: 'postback',
        source: { type: 'user', userId: 'UcancelRequester' },
        replyToken: 'reply-cancel-request',
        postback: { data: `action=wound_cancel_request&woundId=${encodeURIComponent(woundId)}` },
        timestamp: 1710000111000
      }
    ]);

    let logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const requestLog = logs.find((log) => log.woundCancelAction === 'cancel_requested');
    const requestTexts = collectFlexTexts(requestLog.woundCancelPrivateMessages).join('\n');
    const requestActions = collectFlexActions(requestLog.woundCancelPrivateMessages);

    assert.equal(requestLog.woundCancelTargetUserId, 'UcancelOpponent');
    assert.match(requestTexts, /ขอยกเลิกแผล/);
    assert.equal(requestActions.some((action) => action.label === 'ยกเลิก'), true);
    assert.equal(requestActions.some((action) => action.label === 'ไม่ยกเลิก'), true);

    await postWebhook(server.baseUrl, [
      {
        type: 'postback',
        source: { type: 'user', userId: 'UcancelOpponent' },
        replyToken: 'reply-cancel-approve',
        postback: { data: `action=wound_cancel_decision&woundId=${encodeURIComponent(woundId)}&decision=approve` },
        timestamp: 1710000112000
      }
    ]);

    wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].status, 'cancelled');
    assert.equal(wounds[0].cancelApprovedByUserId, 'UcancelOpponent');

    logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.some((log) => log.woundCancelAction === 'cancel_approved'), true);
  } finally {
    await server.stop();
  }
});

test('pushes personal win and loss result cards after confirmed result settlement', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gresult-cards');

    await postWebhook(server.baseUrl, [
      creditEvent('UwinCard', 5000, 'm-credit-result-win', 1710000113000),
      creditEvent('UloseCard', 5000, 'm-credit-result-lose', 1710000113001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-card-open', text: 'เปิด AIO 600-800' },
        timestamp: 1710000114000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'UwinCard', displayName: 'AIO' },
        message: { type: 'text', id: 'm-result-card-trade', text: 'ชล2000' },
        timestamp: 1710000115000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'UloseCard', displayName: 'Bank Thirakan' },
        message: { type: 'text', id: 'm-result-card-accept', quotedMessageId: 'm-result-card-trade', text: 'ต' },
        timestamp: 1710000116000
      },
      confirmPairEvent('Gresult-cards', 'UwinCard', 'm-result-card-accept', 'm-result-card-confirm', 1710000117000),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-card-close', text: 'ปิด' },
        timestamp: 1710000118000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-card-result-a', text: 'แจ้งผล 900' },
        timestamp: 1710000119000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-card-result-b', text: 'แจ้งผล 900' },
        timestamp: 1710000120000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const resultLog = logs.find((log) => log.queueAction === 'result_confirmed');
    const winNotification = resultLog.settlementPrivateNotifications.find((notification) => notification.to === 'UwinCard');
    const loseNotification = resultLog.settlementPrivateNotifications.find((notification) => notification.to === 'UloseCard');
    const winTexts = collectFlexTexts(winNotification.messages).join('\n');
    const loseTexts = collectFlexTexts(loseNotification.messages).join('\n');

    assert.match(winTexts, /ผลรอบ "AIO"/);
    assert.match(winTexts, /\+1,800\.00/);
    assert.match(winTexts, /\+2,000\.00 -10% = \+1,800\.00/);
    assert.match(loseTexts, /ผลรอบ "AIO"/);
    assert.match(loseTexts, /ผลออก 900/);
    assert.match(loseTexts, /❌ แพ้ vs AIO/);
    assert.doesNotMatch(loseTexts, /#\d+/);
    assert.match(loseTexts, /คุณทาย: ทายแพ้ \| ราคา: 600-800/);
    assert.match(loseTexts, /-2,000\.00/);
    assert.match(loseTexts, /แพ้/);
    assert.match(loseTexts, /3,000\.00/);
    assert.match(loseTexts, /คงเหลือ/);
  } finally {
    await server.stop();
  }
});

test('omits unreadable opponent user IDs from active wound cards', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    const openerUserId = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const accepterUserId = 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    await registerAndBindAdmin(server.baseUrl, 'Ghidden-opponent');

    await postWebhook(server.baseUrl, [
      creditEvent(openerUserId, 1000, 'm-credit-hidden-opener', 1710000095000),
      creditEvent(accepterUserId, 1000, 'm-credit-hidden-accepter', 1710000095001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Ghidden-opponent', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-hidden-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000096000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Ghidden-opponent', userId: openerUserId },
        message: { type: 'text', id: 'm-hidden-trade', text: 'ชล600' },
        timestamp: 1710000097000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Ghidden-opponent', userId: accepterUserId },
        message: { type: 'text', id: 'm-hidden-accept', quotedMessageId: 'm-hidden-trade', text: 'ต' },
        timestamp: 1710000098000
      },
      confirmPairEvent('Ghidden-opponent', openerUserId, 'm-hidden-accept', 'm-hidden-confirm', 1710000099000),
      {
        type: 'message',
        source: { type: 'user', userId: openerUserId },
        replyToken: 'reply-hidden-active-wounds',
        message: { type: 'text', id: 'm-hidden-active-wounds', text: 'แผลที่กำลังติด' },
        timestamp: 1710000100000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const activeCardLog = logs.find((log) => log.creditAction === 'active_wounds_card');
    const texts = collectFlexTexts(activeCardLog.creditReplyMessages).join('\n');

    assert.match(texts, /600\.00/);
    assert.doesNotMatch(texts, new RegExp(openerUserId));
    assert.doesNotMatch(texts, new RegExp(accepterUserId));
  } finally {
    await server.stop();
  }
});

test('accepts ช trade keywords with spaced amounts and ignores old ซ keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gspace');

    await postWebhook(server.baseUrl, [
      creditEvent('UspaceOpener1', 300, 'm-credit-space-opener-1', 1710000000000),
      creditEvent('UspaceAccepter1', 300, 'm-credit-space-accepter-1', 1710000000001),
      creditEvent('UspaceOpener2', 650, 'm-credit-space-opener-2', 1710000000002),
      creditEvent('UspaceAccepter2', 650, 'm-credit-space-accepter-2', 1710000000003),
      creditEvent('UlegacyOpener', 300, 'm-credit-legacy-opener', 1710000000004),
      creditEvent('UlegacyAccepter', 300, 'm-credit-legacy-accepter', 1710000000005),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-space-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UspaceOpener1' },
        message: { type: 'text', id: 'm-space-chy', text: 'ชย 300' },
        timestamp: 1710000002000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UspaceAccepter1' },
        message: { type: 'text', id: 'm-space-chy-accept', quotedMessageId: 'm-space-chy', text: 'ต' },
        timestamp: 1710000003000
      },
      confirmPairEvent('Gspace', 'UspaceOpener1', 'm-space-chy-accept', 'm-space-chy-confirm', 1710000003500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UspaceOpener2' },
        message: { type: 'text', id: 'm-space-thor', text: 'ถ 650' },
        timestamp: 1710000004000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UspaceAccepter2' },
        message: { type: 'text', id: 'm-space-thor-accept', quotedMessageId: 'm-space-thor', text: 'ต' },
        timestamp: 1710000005000
      },
      confirmPairEvent('Gspace', 'UspaceOpener2', 'm-space-thor-accept', 'm-space-thor-confirm', 1710000005500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UlegacyOpener' },
        message: { type: 'text', id: 'm-space-legacy-so', text: 'ซย300' },
        timestamp: 1710000006000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gspace', userId: 'UlegacyAccepter' },
        message: { type: 'text', id: 'm-space-legacy-accept', quotedMessageId: 'm-space-legacy-so', text: 'ต' },
        timestamp: 1710000007000
      },
      confirmPairEvent('Gspace', 'UlegacyOpener', 'm-space-legacy-accept', 'm-space-legacy-confirm', 1710000007500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 2);

    const byMessageId = new Map(wounds.map((wound) => [wound.openMessageId, wound]));
    assert.equal(byMessageId.get('m-space-chy').openKeyword, 'ชย');
    assert.equal(byMessageId.get('m-space-chy').amount, '300');
    assert.equal(byMessageId.get('m-space-chy').side, 'chang_yang');
    assert.equal(byMessageId.get('m-space-thor').openKeyword, 'ถ');
    assert.equal(byMessageId.get('m-space-thor').amount, '650');
    assert.equal(byMessageId.get('m-space-thor').side, 'chang_yang');
    assert.equal(byMessageId.has('m-space-legacy-so'), false);
  } finally {
    await server.stop();
  }
});

test('accepts signed trade prefixes from 1 to 30 and ถ.ยั่ง keyword only', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gprefix');

    await postWebhook(server.baseUrl, [
      creditEvent('UprefixOpener1', 300, 'm-credit-prefix-opener-1', 1710000010000),
      creditEvent('UprefixAccepter1', 300, 'm-credit-prefix-accepter-1', 1710000010001),
      creditEvent('UprefixOpener2', 400, 'm-credit-prefix-opener-2', 1710000010002),
      creditEvent('UprefixAccepter2', 400, 'm-credit-prefix-accepter-2', 1710000010003),
      creditEvent('UprefixOpener3', 150, 'm-credit-prefix-opener-3', 1710000010004),
      creditEvent('UprefixAccepter3', 150, 'm-credit-prefix-accepter-3', 1710000010005),
      creditEvent('UyungOpener', 200, 'm-credit-yung-opener', 1710000010006),
      creditEvent('UyungAccepter', 200, 'm-credit-yung-accepter', 1710000010007),
      creditEvent('UoutOpener', 500, 'm-credit-out-opener', 1710000010008),
      creditEvent('UoutAccepter', 500, 'm-credit-out-accepter', 1710000010009),
      creditEvent('UoldYungOpener', 100, 'm-credit-old-yung-opener', 1710000010010),
      creditEvent('UoldYungAccepter', 100, 'm-credit-old-yung-accepter', 1710000010011),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-prefix-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000011000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixOpener1' },
        message: { type: 'text', id: 'm-prefix-plus10-chy', text: '+10ชย 300' },
        timestamp: 1710000012000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixAccepter1' },
        message: { type: 'text', id: 'm-prefix-plus10-chy-accept', quotedMessageId: 'm-prefix-plus10-chy', text: 'ต' },
        timestamp: 1710000013000
      },
      confirmPairEvent('Gprefix', 'UprefixOpener1', 'm-prefix-plus10-chy-accept', 'm-prefix-plus10-chy-confirm', 1710000013500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixOpener2' },
        message: { type: 'text', id: 'm-prefix-minus30-chol', text: '-30ชล 400' },
        timestamp: 1710000014000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixAccepter2' },
        message: { type: 'text', id: 'm-prefix-minus30-chol-accept', quotedMessageId: 'm-prefix-minus30-chol', text: 'ต' },
        timestamp: 1710000015000
      },
      confirmPairEvent('Gprefix', 'UprefixOpener2', 'm-prefix-minus30-chol-accept', 'm-prefix-minus30-chol-confirm', 1710000015500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixOpener3' },
        message: { type: 'text', id: 'm-prefix-plus1-chot', text: '+1ชถ 150' },
        timestamp: 1710000016000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UprefixAccepter3' },
        message: { type: 'text', id: 'm-prefix-plus1-chot-accept', quotedMessageId: 'm-prefix-plus1-chot', text: 'ต' },
        timestamp: 1710000017000
      },
      confirmPairEvent('Gprefix', 'UprefixOpener3', 'm-prefix-plus1-chot-accept', 'm-prefix-plus1-chot-confirm', 1710000017500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UyungOpener' },
        message: { type: 'text', id: 'm-prefix-yung', text: 'ถ.ยั่ง 200' },
        timestamp: 1710000018000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UyungAccepter' },
        message: { type: 'text', id: 'm-prefix-yung-accept', quotedMessageId: 'm-prefix-yung', text: 'ต' },
        timestamp: 1710000019000
      },
      confirmPairEvent('Gprefix', 'UyungOpener', 'm-prefix-yung-accept', 'm-prefix-yung-confirm', 1710000019500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UoutOpener' },
        message: { type: 'text', id: 'm-prefix-plus31', text: '+31ชล 500' },
        timestamp: 1710000020000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UoutAccepter' },
        message: { type: 'text', id: 'm-prefix-plus31-accept', quotedMessageId: 'm-prefix-plus31', text: 'ต' },
        timestamp: 1710000021000
      },
      confirmPairEvent('Gprefix', 'UoutOpener', 'm-prefix-plus31-accept', 'm-prefix-plus31-confirm', 1710000021500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UoldYungOpener' },
        message: { type: 'text', id: 'm-prefix-old-yung', text: 'ถ.ยัง 100' },
        timestamp: 1710000022000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gprefix', userId: 'UoldYungAccepter' },
        message: { type: 'text', id: 'm-prefix-old-yung-accept', quotedMessageId: 'm-prefix-old-yung', text: 'ต' },
        timestamp: 1710000023000
      },
      confirmPairEvent('Gprefix', 'UoldYungOpener', 'm-prefix-old-yung-accept', 'm-prefix-old-yung-confirm', 1710000023500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 4);

    const byMessageId = new Map(wounds.map((wound) => [wound.openMessageId, wound]));
    assert.equal(byMessageId.get('m-prefix-plus10-chy').openKeyword, '+10ชย');
    assert.equal(byMessageId.get('m-prefix-plus10-chy').amount, '300');
    assert.equal(byMessageId.get('m-prefix-minus30-chol').openKeyword, '-30ชล');
    assert.equal(byMessageId.get('m-prefix-minus30-chol').amount, '400');
    assert.equal(byMessageId.get('m-prefix-plus1-chot').openKeyword, '+1ชถ');
    assert.equal(byMessageId.get('m-prefix-plus1-chot').amount, '150');
    assert.equal(byMessageId.get('m-prefix-yung').openKeyword, 'ถ.ยั่ง');
    assert.equal(byMessageId.get('m-prefix-yung').amount, '200');
    assert.equal(byMessageId.has('m-prefix-plus31'), false);
    assert.equal(byMessageId.has('m-prefix-old-yung'), false);
  } finally {
    await server.stop();
  }
});

test('accepts custom Thai prices and reserves extra credit for ชตย stakes', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcustom');

    await postWebhook(server.baseUrl, [
      creditEvent('UcustomOpener1', 500, 'm-credit-custom-opener-1', 1710000040000),
      creditEvent('UcustomAccepter1', 500, 'm-credit-custom-accepter-1', 1710000040001),
      creditEvent('UcustomOpener2', 100, 'm-credit-custom-opener-2', 1710000040002),
      creditEvent('UcustomAccepter2', 100, 'm-credit-custom-accepter-2', 1710000040003),
      creditEvent('UfallbackOpener', 1000, 'm-credit-fallback-opener', 1710000040004),
      creditEvent('UfallbackAccepter', 1000, 'm-credit-fallback-accepter', 1710000040005),
      creditEvent('UnoBuilderOpener', 100, 'm-credit-no-builder-opener', 1710000040006),
      creditEvent('UnoBuilderAccepter', 100, 'm-credit-no-builder-accepter', 1710000040007),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-custom-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000041000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UcustomOpener1' },
        message: { type: 'text', id: 'm-custom-range-lai', text: '300-340ล500' },
        timestamp: 1710000042000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UcustomAccepter1' },
        message: { type: 'text', id: 'm-custom-range-lai-accept', quotedMessageId: 'm-custom-range-lai', text: 'ต' },
        timestamp: 1710000043000
      },
      confirmPairEvent('Gcustom', 'UcustomOpener1', 'm-custom-range-lai-accept', 'm-custom-range-lai-confirm', 1710000043500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UcustomOpener2' },
        message: { type: 'text', id: 'm-custom-single-thoi', text: '400ถ100' },
        timestamp: 1710000044000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UcustomAccepter2' },
        message: { type: 'text', id: 'm-custom-single-thoi-accept', quotedMessageId: 'm-custom-single-thoi', text: 'ต' },
        timestamp: 1710000045000
      },
      confirmPairEvent('Gcustom', 'UcustomOpener2', 'm-custom-single-thoi-accept', 'm-custom-single-thoi-confirm', 1710000045500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UfallbackOpener' },
        message: { type: 'text', id: 'm-custom-fallback', text: '345-385ล500 ชตย' },
        timestamp: 1710000046000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UfallbackAccepter' },
        message: { type: 'text', id: 'm-custom-fallback-accept', quotedMessageId: 'm-custom-fallback', text: 'ต' },
        timestamp: 1710000047000
      },
      confirmPairEvent('Gcustom', 'UfallbackOpener', 'm-custom-fallback-accept', 'm-custom-fallback-confirm', 1710000047500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UnoBuilderOpener' },
        message: { type: 'text', id: 'm-custom-no-builder', text: '360-390ถ ชตย' },
        timestamp: 1710000048000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom', userId: 'UnoBuilderAccepter' },
        message: { type: 'text', id: 'm-custom-no-builder-accept', quotedMessageId: 'm-custom-no-builder', text: 'ต' },
        timestamp: 1710000049000
      },
      confirmPairEvent('Gcustom', 'UnoBuilderOpener', 'm-custom-no-builder-accept', 'm-custom-no-builder-confirm', 1710000049500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 4);

    const byMessageId = new Map(wounds.map((wound) => [wound.openMessageId, wound]));
    assert.equal(byMessageId.get('m-custom-range-lai').openKeyword, 'ล');
    assert.equal(byMessageId.get('m-custom-range-lai').priceRaw, '300-340');
    assert.equal(byMessageId.get('m-custom-range-lai').amount, '500');
    assert.equal(byMessageId.get('m-custom-range-lai').requiredCredit, 500);
    assert.equal(byMessageId.get('m-custom-single-thoi').openKeyword, 'ถ');
    assert.equal(byMessageId.get('m-custom-single-thoi').priceRaw, '400');
    assert.equal(byMessageId.get('m-custom-single-thoi').amount, '100');
    assert.equal(byMessageId.get('m-custom-fallback').fallbackNoBuilder, true);
    assert.equal(byMessageId.get('m-custom-fallback').amount, '500');
    assert.equal(byMessageId.get('m-custom-fallback').requiredCredit, 1000);
    assert.equal(byMessageId.get('m-custom-no-builder').fallbackNoBuilder, true);
    assert.equal(byMessageId.get('m-custom-no-builder').priceRaw, '360-390');
    assert.equal(byMessageId.get('m-custom-no-builder').amount, '');
    assert.equal(byMessageId.get('m-custom-no-builder').requiredCredit, 0);
  } finally {
    await server.stop();
  }
});

test('admin can announce no-builder play rules and mark the current round as no builder', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gno-builder-announce');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-announce', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000049600
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-announce', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-announce', text: 'ช่างบ่ตี @All' },
        timestamp: 1710000049700
      }
    ]);

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].queueName, 'ศราช');
    assert.equal(rounds[0].noBuilderPrice, true);
    assert.equal(rounds[0].priceRaw, '');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const announcementLog = logs.find((log) => log.queueAction === 'no_builder_announced');
    assert.ok(announcementLog);
    assert.match(announcementLog.queueReplyTexts.join('\n'), /ช่างตีไม่ติด/);
    assert.match(announcementLog.queueReplyTexts.join('\n'), /ช่างตียก/);
  } finally {
    await server.stop();
  }
});

test('tracks all trade examples from the latest play guide', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/messages');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gguide');

    const examples = [
      ['m-guide-chol', 'ชล200', 'ชล', '200', 'chang_dai'],
      ['m-guide-chy', 'ชย500', 'ชย', '500', 'chang_yang'],
      ['m-guide-chot', 'ชถ300', 'ชถ', '300', 'chang_yang'],
      ['m-guide-plus-thor', '+5ถ500', '+5ถ', '500', 'chang_yang'],
      ['m-guide-plus-lai', '+5ล300', '+5ล', '300', 'chang_dai'],
      ['m-guide-single-lai', '400ล100', 'ล', '100', 'chang_dai'],
      ['m-guide-range-lai', '320-350ล500', 'ล', '500', 'chang_dai'],
      ['m-guide-range-thor', '370-420ถ1000', 'ถ', '1000', 'chang_yang'],
      ['m-guide-fallback', '330-370ล1000 ชตย', 'ล', '1000', 'chang_dai'],
      ['m-guide-builder-lai', 'ช่างไล่200', 'ช่างไล่', '200', 'chang_dai'],
      ['m-guide-builder-thoi', 'ช่างถอย500', 'ช่างถอย', '500', 'chang_yang'],
      ['m-guide-builder-yang', 'ช่างยั่ง100', 'ช่างยั่ง', '100', 'chang_yang'],
      ['m-guide-builder-ma', 'ช่างมา10000', 'ช่างมา', '10000', 'number_ma'],
      ['m-guide-chot-live', 'ชถ100', 'ชถ', '100', 'chang_yang']
    ];

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gguide', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-guide-open-round', text: 'เปิด กอดก้อนเมฆ 300-350' },
        timestamp: 1710000040200
      },
      ...examples.map(([id, text], index) => ({
        type: 'message',
        source: { type: 'group', groupId: 'Gguide', userId: `Uguide${index}` },
        message: { type: 'text', id, text },
        timestamp: 1710000040300 + index
      }))
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const byMessageText = new Map(logs.map((log) => [log.message, log]));
    const messages = JSON.parse(fs.readFileSync('messages.json', 'utf8'));
    const messageById = new Map(messages.map((message) => [message.id, message]));

    for (const [id, text, keyword, amount, side] of examples) {
      const log = byMessageText.get(text);
      assert.ok(log, text);
      assert.equal(log.tradeKeyword, keyword, text);
      assert.equal(String(log.tradeAmount), amount, text);
      const message = messageById.get(id);
      assert.equal(message.trade.side, side, text);
    }
  } finally {
    await server.stop();
  }
});

test('no-builder fallback aliases reserve credit and auto-cancel when a builder price is later set', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gno-builder-fallback');

    await postWebhook(server.baseUrl, [
      creditEvent('UnoBuilderFallbackOpen', 1000, 'm-credit-no-builder-fallback-open', 1710000049800),
      creditEvent('UnoBuilderFallbackAccept', 1000, 'm-credit-no-builder-fallback-accept', 1710000049801),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-open-round', text: 'เปิด ศราช' },
        timestamp: 1710000049900
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-announce', text: 'ช่างไม่ตี' },
        timestamp: 1710000049950
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'UnoBuilderFallbackOpen' },
        message: { type: 'text', id: 'm-no-builder-fallback-trade', text: '345-385ล500' },
        timestamp: 1710000050000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'UnoBuilderFallbackAccept' },
        message: {
          type: 'text',
          id: 'm-no-builder-fallback-accept',
          quotedMessageId: 'm-no-builder-fallback-trade',
          text: 'ช่างตีไม่ติด'
        },
        timestamp: 1710000050100
      },
      confirmPairEvent(
        'Gno-builder-fallback',
        'UnoBuilderFallbackOpen',
        'm-no-builder-fallback-accept',
        'm-no-builder-fallback-confirm',
        1710000050200
      ),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-close', text: 'ปิด' },
        timestamp: 1710000050300
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-price', text: 'ราคาช่าง 300-320' },
        timestamp: 1710000050400
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-result-1', text: 'แจ้งผล 400' },
        timestamp: 1710000050500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gno-builder-fallback', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-no-builder-fallback-result-2', text: 'แจ้งผล 400' },
        timestamp: 1710000050600
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].fallbackNoBuilder, true);
    assert.equal(wounds[0].requiredCredit, 1000);
    assert.equal(wounds[0].settlementStatus, 'cancelled_no_builder_fallback');
    assert.equal(wounds[0].winnerUserId, '');
    assert.equal(wounds[0].loserUserId, '');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('UnoBuilderFallbackOpen').balance, 1000);
    assert.equal(byUserId.get('UnoBuilderFallbackAccept').balance, 1000);
  } finally {
    await server.stop();
  }
});

test('settles number มา custom prices by range during no-builder rounds', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gnumber-ma');

    await postWebhook(server.baseUrl, [
      creditEvent('UnumberMaOpen', 200, 'm-credit-number-ma-open', 1710000050700),
      creditEvent('UnumberMaAccept', 200, 'm-credit-number-ma-accept', 1710000050701),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-number-ma-open-round', text: 'เปิด ตัวเลข ช่างไม่ตี' },
        timestamp: 1710000050800
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'UnumberMaOpen' },
        message: { type: 'text', id: 'm-number-ma-trade', text: '380-425 มา100 ช่างตียก' },
        timestamp: 1710000050900
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'UnumberMaAccept' },
        message: { type: 'text', id: 'm-number-ma-accept', quotedMessageId: 'm-number-ma-trade', text: 'ต' },
        timestamp: 1710000051000
      },
      confirmPairEvent('Gnumber-ma', 'UnumberMaOpen', 'm-number-ma-accept', 'm-number-ma-confirm', 1710000051100),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-number-ma-close', text: 'ปิด' },
        timestamp: 1710000051200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-number-ma-result-1', text: 'แจ้งผล 400' },
        timestamp: 1710000051300
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-number-ma-result-2', text: 'แจ้งผล 400' },
        timestamp: 1710000051400
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].openKeyword, 'มา');
    assert.equal(wounds[0].priceRaw, '380-425');
    assert.equal(wounds[0].fallbackNoBuilder, true);
    assert.equal(wounds[0].requiredCredit, 200);
    assert.equal(wounds[0].settlementStatus, 'settled');
    assert.equal(wounds[0].winnerUserId, 'UnumberMaOpen');
    assert.equal(wounds[0].loserUserId, 'UnumberMaAccept');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('UnumberMaOpen').balance, 290);
    assert.equal(byUserId.get('UnumberMaAccept').balance, 100);
  } finally {
    await server.stop();
  }
});

test('rejects shorthand number มา custom prices', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gnumber-ma-short');

    await postWebhook(server.baseUrl, [
      creditEvent('UnumberMaShortOpen', 200, 'm-credit-number-ma-short-open', 1710000050700),
      creditEvent('UnumberMaShortAccept', 200, 'm-credit-number-ma-short-accept', 1710000050701),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma-short', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-number-ma-short-open-round', text: 'เปิด ตัวเลข ช่างไม่ตี' },
        timestamp: 1710000050800
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma-short', userId: 'UnumberMaShortOpen' },
        message: { type: 'text', id: 'm-number-ma-short-trade', text: '8-25 มา100 ช่างตียก' },
        timestamp: 1710000050900
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnumber-ma-short', userId: 'UnumberMaShortAccept' },
        message: { type: 'text', id: 'm-number-ma-short-accept', quotedMessageId: 'm-number-ma-short-trade', text: 'ต' },
        timestamp: 1710000051000
      },
      confirmPairEvent('Gnumber-ma-short', 'UnumberMaShortOpen', 'm-number-ma-short-accept', 'm-number-ma-short-confirm', 1710000051100)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 0);
  } finally {
    await server.stop();
  }
});

test('rejects slash custom prices, old a prices, and ชตย stakes without reserve credit', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcustom-reject');

    await postWebhook(server.baseUrl, [
      creditEvent('UfallbackPoorOpener', 1000, 'm-credit-fallback-poor-opener', 1710000050000),
      creditEvent('UfallbackPoorAccepter', 1000, 'm-credit-fallback-poor-accepter', 1710000050001),
      creditEvent('UslashOpener', 500, 'm-credit-slash-opener', 1710000050002),
      creditEvent('UslashAccepter', 500, 'm-credit-slash-accepter', 1710000050003),
      creditEvent('UaOpener', 500, 'm-credit-a-opener', 1710000050004),
      creditEvent('UaAccepter', 500, 'm-credit-a-accepter', 1710000050005),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-custom-reject-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000051000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UfallbackPoorOpener' },
        message: { type: 'text', id: 'm-custom-fallback-poor', text: '330-350ล1000ชตย' },
        timestamp: 1710000052000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UfallbackPoorAccepter' },
        message: { type: 'text', id: 'm-custom-fallback-poor-accept', quotedMessageId: 'm-custom-fallback-poor', text: 'ต' },
        timestamp: 1710000053000
      },
      confirmPairEvent('Gcustom-reject', 'UfallbackPoorOpener', 'm-custom-fallback-poor-accept', 'm-custom-fallback-poor-confirm', 1710000053500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UslashOpener' },
        message: { type: 'text', id: 'm-custom-slash', text: '300/340ล500' },
        timestamp: 1710000054000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UslashAccepter' },
        message: { type: 'text', id: 'm-custom-slash-accept', quotedMessageId: 'm-custom-slash', text: 'ต' },
        timestamp: 1710000055000
      },
      confirmPairEvent('Gcustom-reject', 'UslashOpener', 'm-custom-slash-accept', 'm-custom-slash-confirm', 1710000055500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UaOpener' },
        message: { type: 'text', id: 'm-custom-old-a', text: '230-250a200' },
        timestamp: 1710000056000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcustom-reject', userId: 'UaAccepter' },
        message: { type: 'text', id: 'm-custom-old-a-accept', quotedMessageId: 'm-custom-old-a', text: 'ต' },
        timestamp: 1710000057000
      },
      confirmPairEvent('Gcustom-reject', 'UaOpener', 'm-custom-old-a-accept', 'm-custom-old-a-confirm', 1710000057500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 0);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const rejectedLog = logs.find(
      (log) => log.openMessageId === 'm-custom-fallback-poor' && log.woundRejectedReason === 'insufficient_credit'
    );
    assert.equal(rejectedLog.woundRejectedReason, 'insufficient_credit');
    assert.equal(rejectedLog.requiredCredit, 2000);
    assert.deepEqual(rejectedLog.insufficientCreditUsers.sort(), ['UfallbackPoorAccepter', 'UfallbackPoorOpener'].sort());
  } finally {
    await server.stop();
  }
});

test('warns when the same user repeats the same trade three times in an open round', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Grepeat-trade');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-trade', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000058000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-trade', userId: 'UrepeatTrade' },
        message: { type: 'text', id: 'm-repeat-trade-1', text: '+5ถ.200' },
        timestamp: 1710000059000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-trade', userId: 'UotherTrade' },
        message: { type: 'text', id: 'm-repeat-other-trade', text: 'ชล1000' },
        timestamp: 1710000060000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-trade', userId: 'UrepeatTrade' },
        message: { type: 'text', id: 'm-repeat-trade-2', text: '+5ถ.200' },
        timestamp: 1710000061000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-trade', userId: 'UrepeatTrade' },
        message: { type: 'text', id: 'm-repeat-trade-3', text: '+5ถ.200' },
        timestamp: 1710000062000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const warningLog = logs.find((log) => log.repeatedTradeWarning);
    const repeatedTradeLogs = logs.filter((log) => log.userId === 'UrepeatTrade' && log.tradeKeyword === '+5ถ');

    assert.equal(repeatedTradeLogs.length, 3);
    assert.equal(repeatedTradeLogs.every((log) => log.tradeAmount === '200'), true);
    assert.ok(warningLog);
    assert.equal(warningLog.message, '+5ถ.200');
    assert.equal(warningLog.repeatedTradeCount, 3);
    assert.equal(warningLog.repeatedTradeReplyTexts.length, 1);
    assert.match(warningLog.repeatedTradeReplyTexts[0], /ตอบติดกัน ขยับติดกัน/);
    assert.match(warningLog.repeatedTradeReplyTexts[0], /รอการตลาด/);
  } finally {
    await server.stop();
  }
});

test('counts repeated trade warnings separately for each opened round', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Grepeat-per-round');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-round-1-open', text: 'เปิด รอบหนึ่ง' },
        timestamp: 1710000063000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'UrepeatPerRound' },
        message: { type: 'text', id: 'm-repeat-round-1-trade-1', text: '+5ถ.200' },
        timestamp: 1710000064000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'UrepeatPerRound' },
        message: { type: 'text', id: 'm-repeat-round-1-trade-2', text: '+5ถ.200' },
        timestamp: 1710000065000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-round-1-close', text: 'ปิด' },
        timestamp: 1710000066000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-round-1-result-1', text: 'แจ้งผล 300' },
        timestamp: 1710000067000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-round-1-result-2', text: 'แจ้งผล 300' },
        timestamp: 1710000068000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-round-2-open', text: 'เปิด รอบสอง' },
        timestamp: 1710000069000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-per-round', userId: 'UrepeatPerRound' },
        message: { type: 'text', id: 'm-repeat-round-2-trade-1', text: '+5ถ.200' },
        timestamp: 1710000070000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const repeatedTradeLogs = logs.filter((log) => log.userId === 'UrepeatPerRound' && log.tradeKeyword === '+5ถ');

    assert.equal(repeatedTradeLogs.length, 3);
    assert.equal(logs.some((log) => log.repeatedTradeWarning), false);
  } finally {
    await server.stop();
  }
});

test('requires duplicate result command before closing active wounds', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'G2');

    await postWebhook(server.baseUrl, [
      creditEvent('Ubuyer', 5000, 'm-credit-buyer-2', 1710000000000),
      creditEvent('Useller', 5000, 'm-credit-seller-2', 1710000000000),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-round-open-2', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000000500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Ubuyer' },
        message: { type: 'text', id: 'm-open-2', text: 'ชย500' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Useller' },
        message: { type: 'text', id: 'm-accept-2', quotedMessageId: 'm-open-2', text: 'เค' },
        timestamp: 1710000002000
      },
      confirmPairEvent('G2', 'Ubuyer', 'm-accept-2', 'm-confirm-2', 1710000002300),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-round-close-2', text: 'ปิด' },
        timestamp: 1710000002500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-2', text: 'แจ้งผล 50' },
        timestamp: 1710000003000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G2', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-3', text: 'แจ้งผล 50' },
        timestamp: 1710000004000
      }
    ]);

    const response = await fetch(`${server.baseUrl}/api/wounds`);
    assert.equal(response.status, 200);

    const wounds = await response.json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].status, 'closed');
    assert.equal(wounds[0].result, '50');
    assert.equal(wounds[0].closedByUserId, 'Uadmin');
  } finally {
    await server.stop();
  }
});

test('opens a queue round and ignores new wounds after close', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'G3');

    await postWebhook(server.baseUrl, [
      creditEvent('Ubuyer', 5000, 'm-credit-buyer-3', 1710000000000),
      creditEvent('Useller', 5000, 'm-credit-seller-3', 1710000000000),
      creditEvent('Ubuyer2', 5000, 'm-credit-buyer-late-3', 1710000000000),
      creditEvent('Useller2', 5000, 'm-credit-seller-late-3', 1710000000000),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Uadmin' },
        replyToken: 'reply-open',
        message: { type: 'text', id: 'm-open-round', text: 'เปิด กอดก้อนเมฆ 300-320' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Ubuyer' },
        message: { type: 'text', id: 'm-open-trade', text: 'ชล1000' },
        timestamp: 1710000002000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Useller' },
        message: { type: 'text', id: 'm-open-accept', quotedMessageId: 'm-open-trade', text: 'ต' },
        timestamp: 1710000003000
      },
      confirmPairEvent('G3', 'Ubuyer', 'm-open-accept', 'm-open-confirm', 1710000003500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Uadmin' },
        replyToken: 'reply-close',
        message: { type: 'text', id: 'm-close-round', text: 'ปิด' },
        timestamp: 1710000004000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Ubuyer2' },
        message: { type: 'text', id: 'm-late-trade', text: 'ชล2000' },
        timestamp: 1710000005000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G3', userId: 'Useller2' },
        message: { type: 'text', id: 'm-late-accept', quotedMessageId: 'm-late-trade', text: 'ต' },
        timestamp: 1710000006000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].roundName, 'กอดก้อนเมฆ');

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].queueName, 'กอดก้อนเมฆ');
    assert.equal(rounds[0].priceRaw, '300-320');
    assert.equal(rounds[0].status, 'closed');
  } finally {
    await server.stop();
  }
});

test('admin can cancel the current queue and every active wound by queue name', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-cancel');

    await postWebhook(server.baseUrl, [
      creditEvent('UcancelQueueOpen', 200, 'm-credit-queue-cancel-open', 1710000190000),
      creditEvent('UcancelQueueAccept', 200, 'm-credit-queue-cancel-accept', 1710000190001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-cancel', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-cancel-open', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000191000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-cancel', userId: 'UcancelQueueOpen' },
        message: { type: 'text', id: 'm-queue-cancel-trade', text: 'ชล200' },
        timestamp: 1710000192000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-cancel', userId: 'UcancelQueueAccept' },
        message: { type: 'text', id: 'm-queue-cancel-accept', quotedMessageId: 'm-queue-cancel-trade', text: 'ต' },
        timestamp: 1710000193000
      },
      confirmPairEvent('Gqueue-cancel', 'UcancelQueueOpen', 'm-queue-cancel-accept', 'm-queue-cancel-confirm', 1710000193500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-cancel', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-cancel-command', text: 'ยกเลิกกอดก้อนเมฆ' },
        timestamp: 1710000194000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-cancel', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-cancel-open-next', text: 'เปิด น้องเหมียว' },
        timestamp: 1710000195000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].status, 'cancelled');
    assert.equal(wounds[0].cancelReason, 'queue_cancelled');
    assert.equal(wounds[0].cancelledByUserId, 'Uadmin');

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].queueName, 'น้องเหมียว');
    assert.equal(rounds[0].status, 'open');
    assert.equal(rounds[1].queueName, 'กอดก้อนเมฆ');
    assert.equal(rounds[1].status, 'cancelled');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const cancelLog = logs.find((log) => log.queueAction === 'round_cancelled');
    assert.equal(cancelLog.cancelledCount, 1);
    assert.match(cancelLog.queueReplyTexts[0], /ยกเลิกคิว: กอดก้อนเมฆ/);
    assert.match(cancelLog.queueReplyTexts[0], /ยกเลิกทุกแผล/);
  } finally {
    await server.stop();
  }
});

test('opens a queue round waiting for builder price from admin keyword', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gwait-builder-price');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gwait-builder-price', userId: 'Uadmin' },
        replyToken: 'reply-wait-builder-price',
        message: { type: 'text', id: 'm-wait-builder-price', text: 'รอราคาช่าง, เบริดอาค้า' },
        timestamp: 1710000007000
      }
    ]);

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].queueName, 'เบริดอาค้า');
    assert.equal(rounds[0].priceRaw, '');
    assert.equal(rounds[0].noBuilderPrice, false);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const waitPriceLog = logs.find((log) => log.queueAction === 'round_opened');
    assert.deepEqual(waitPriceLog.queueReplyTexts, ['เบริดอาค้า\n\nช่าง ⛔️\n\n🚀🚀🚀🚀🚀']);
  } finally {
    await server.stop();
  }
});

test('replies with the queue card format after setting the builder price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gbuilder-price', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-open', text: 'เปิด ศราช' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-close', text: 'ปิด' },
        timestamp: 1710000002000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-price', text: 'ราคาช่าง 350-380' },
        timestamp: 1710000003000
      }
    ]);

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].queueName, 'ศราช');
    assert.equal(rounds[0].priceRaw, '350-380');
    assert.equal(rounds[0].noBuilderPrice, false);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const priceLog = logs.find((log) => log.queueAction === 'builder_price_set');

    assert.deepEqual(priceLog.queueReplyTexts, ['ศราช\n\nช่าง 350-380 ⛔️\n\n🚀🚀🚀🚀🚀']);
  } finally {
    await server.stop();
  }
});

test('keeps a single builder price as one exact price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gbuilder-single-price', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-single-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-single-open', text: 'เปิด ศราช' },
        timestamp: 1710000001100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-single-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-single-close', text: 'ปิด' },
        timestamp: 1710000002100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbuilder-single-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-builder-single-price', text: 'ราคาช่าง350' },
        timestamp: 1710000003100
      }
    ]);

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].queueName, 'ศราช');
    assert.equal(rounds[0].priceRaw, '350');
    assert.equal(rounds[0].priceLow, 350);
    assert.equal(rounds[0].priceHigh, 350);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const priceLog = logs.find((log) => log.queueAction === 'builder_price_set');
    assert.deepEqual(priceLog.queueReplyTexts, ['ศราช\n\nช่าง 350 ⛔️\n\n🚀🚀🚀🚀🚀']);
  } finally {
    await server.stop();
  }
});

test('sends open queue card only from admin reminder keywords', async () => {
  const pushRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/v2/bot/message/push') {
      pushRequests.push(JSON.parse(bodyText || '{}'));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Grepeat-builder-price', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-builder-open', text: 'เปิด นายกบุญช่วย' },
        timestamp: 1710000200000
      }
    ]);

    await delay(90);
    assert.equal(pushRequests.length, 0);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-wait-short', text: 'รอ' },
        timestamp: 1710000200100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-wait-price', text: 'รอราคาช่าง' },
        timestamp: 1710000200200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-ready-too-early', text: 'ลุย' },
        timestamp: 1710000200300
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-builder-price', text: 'ราคาช่าง 200-250' },
        timestamp: 1710000200400
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-ready-go', text: 'ลุย' },
        timestamp: 1710000200500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-ready-here', text: 'มาละ' },
        timestamp: 1710000200600
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-ready-confirm', text: 'ตามนั้น' },
        timestamp: 1710000200700
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-wait-after-price', text: 'รอ' },
        timestamp: 1710000200800
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const reminderLogs = logs.filter((log) => log.queueAction === 'round_manual_reminder');
    const reminderByMessage = new Map(reminderLogs.map((log) => [log.message, log.queueReplyTexts[0]]));

    assert.equal(reminderLogs.length, 5);
    assert.equal(reminderByMessage.get('รอ'), 'นายกบุญช่วย\n\nช่าง ⛔️\n\n🚀🚀🚀🚀🚀');
    assert.equal(reminderByMessage.get('รอราคาช่าง'), 'นายกบุญช่วย\n\nช่าง ⛔️\n\n🚀🚀🚀🚀🚀');
    assert.equal(reminderByMessage.get('ลุย'), 'นายกบุญช่วย\n\nช่าง 200-250 ⛔️\n\n🚀🚀🚀🚀🚀');
    assert.equal(reminderByMessage.get('มาละ'), 'นายกบุญช่วย\n\nช่าง 200-250 ⛔️\n\n🚀🚀🚀🚀🚀');
    assert.equal(reminderByMessage.get('ตามนั้น'), 'นายกบุญช่วย\n\nช่าง 200-250 ⛔️\n\n🚀🚀🚀🚀🚀');
    assert.equal(logs.some((log) => log.message === 'รอ' && log.timestamp === 1710000200800 && log.queueAction), false);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-repeat-builder-close', text: 'ปิด' },
        timestamp: 1710000201000
      }
    ]);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Grepeat-builder-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-remind-ready-after-close', text: 'ลุย' },
        timestamp: 1710000201100
      }
    ]);

    const logsAfterClose = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logsAfterClose.some((log) => log.message === 'ลุย' && log.timestamp === 1710000201100 && log.queueAction), false);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('adds close image after the close queue text reply', async () => {
  const replyRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/v2/bot/message/reply') {
      replyRequests.push(JSON.parse(bodyText || '{}'));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl,
    PUBLIC_BASE_URL: 'https://lamp-cover.example'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gclose-image', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gclose-image', userId: 'Uadmin' },
        replyToken: 'reply-close-open',
        message: { type: 'text', id: 'm-close-image-open', text: 'เปิด แอ็ดเทวดา' },
        timestamp: 1710000210000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gclose-image', userId: 'Uadmin' },
        replyToken: 'reply-close-image',
        message: { type: 'text', id: 'm-close-image-close', text: 'ปิด' },
        timestamp: 1710000211000
      }
    ]);

    const closeReply = replyRequests.find((request) => request.replyToken === 'reply-close-image');
    assert.ok(closeReply);
    assert.equal(closeReply.messages.length, 2);
    assert.equal(closeReply.messages[0].type, 'text');
    assert.match(closeReply.messages[0].text, /❌❌❌❌ ปิด ❌❌❌❌/);
    assert.deepEqual(closeReply.messages[1], {
      type: 'image',
      originalContentUrl: 'https://lamp-cover.example/assets/close.jpg',
      previewImageUrl: 'https://lamp-cover.example/assets/close.jpg'
    });

    const imageResponse = await fetch(`${server.baseUrl}/assets/close.jpg`);
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('content-type') || '', /image\/jpeg/);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('confirms result twice and records the queue price verdict', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'G4');

    await postWebhook(server.baseUrl, [
      creditEvent('Ubuyer', 5000, 'm-credit-buyer-4', 1710000000000),
      creditEvent('Useller', 5000, 'm-credit-seller-4', 1710000000000),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-open-result-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Ubuyer' },
        message: { type: 'text', id: 'm-result-trade', text: 'ชล1000' },
        timestamp: 1710000002000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Useller' },
        message: { type: 'text', id: 'm-result-accept', quotedMessageId: 'm-result-trade', text: 'เค' },
        timestamp: 1710000003000
      },
      confirmPairEvent('G4', 'Ubuyer', 'm-result-accept', 'm-result-confirm-pair', 1710000003500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-close', text: 'ปิด' },
        timestamp: 1710000004000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-price', text: 'ราคาช่าง 300-320' },
        timestamp: 1710000005000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-first', text: 'แจ้งผล 438' },
        timestamp: 1710000006000
      }
    ]);

    let wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].status, 'active');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'G4', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-second', text: 'แจ้งผล 438' },
        timestamp: 1710000007000
      }
    ]);

    wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].status, 'closed');
    assert.equal(wounds[0].result, '438');

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].status, 'resulted');
    assert.equal(rounds[0].result, '438');
    assert.equal(rounds[0].resultIcon, '✅');
  } finally {
    await server.stop();
  }
});

test('settles a ไล่ prediction as winner with 0.90 payout', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsettle-dai');

    await postWebhook(server.baseUrl, [
      creditEvent('Urunner', 200, 'm-credit-runner', 1710000070000),
      creditEvent('Ufader', 200, 'm-credit-fader', 1710000070001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-dai-open', text: 'เปิด ส.รุ่งตะวัน 320-360' },
        timestamp: 1710000071000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Urunner' },
        message: { type: 'text', id: 'm-settle-dai-trade', text: 'ชล100' },
        timestamp: 1710000072000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Ufader' },
        message: { type: 'text', id: 'm-settle-dai-accept', quotedMessageId: 'm-settle-dai-trade', text: 'ต' },
        timestamp: 1710000073000
      },
      confirmPairEvent('Gsettle-dai', 'Urunner', 'm-settle-dai-accept', 'm-settle-dai-confirm', 1710000073500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-dai-close', text: 'ปิด' },
        timestamp: 1710000074000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-dai-result-1', text: 'แจ้งผล 400' },
        timestamp: 1710000075000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-dai-result-2', text: 'แจ้งผล 400' },
        timestamp: 1710000076000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].openerPrediction, 'ทายชนะ');
    assert.equal(wounds[0].accepterPrediction, 'ทายแพ้');
    assert.equal(wounds[0].settlementStatus, 'settled');
    assert.equal(wounds[0].winningSide, 'chang_dai');
    assert.equal(wounds[0].winnerUserId, 'Urunner');
    assert.equal(wounds[0].loserUserId, 'Ufader');
    assert.equal(wounds[0].stakeAmount, 100);
    assert.equal(wounds[0].winnerPayoutAmount, 90);
    assert.equal(wounds[0].systemFeeAmount, 10);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('Urunner').balance, 290);
    assert.equal(byUserId.get('Ufader').balance, 100);
  } finally {
    await server.stop();
  }
});

test('settles a ถอย or ยั่ง prediction as winner when the result is below the builder price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsettle-yang');

    await postWebhook(server.baseUrl, [
      creditEvent('Ufader', 200, 'm-credit-yang-fader', 1710000080000),
      creditEvent('Urunner', 200, 'm-credit-yang-runner', 1710000080001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-yang-open', text: 'เปิด ส.รุ่งตะวัน 320-360' },
        timestamp: 1710000081000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Ufader' },
        message: { type: 'text', id: 'm-settle-yang-trade', text: 'ถ100' },
        timestamp: 1710000082000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Urunner' },
        message: { type: 'text', id: 'm-settle-yang-accept', quotedMessageId: 'm-settle-yang-trade', text: 'ต' },
        timestamp: 1710000083000
      },
      confirmPairEvent('Gsettle-yang', 'Ufader', 'm-settle-yang-accept', 'm-settle-yang-confirm', 1710000083500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-yang-close', text: 'ปิด' },
        timestamp: 1710000084000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-yang-result-1', text: 'แจ้งผล 300' },
        timestamp: 1710000085000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-yang-result-2', text: 'แจ้งผล 300' },
        timestamp: 1710000086000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].openerPrediction, 'ทายแพ้');
    assert.equal(wounds[0].accepterPrediction, 'ทายชนะ');
    assert.equal(wounds[0].settlementStatus, 'settled');
    assert.equal(wounds[0].winningSide, 'chang_yang');
    assert.equal(wounds[0].winnerUserId, 'Ufader');
    assert.equal(wounds[0].loserUserId, 'Urunner');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('Ufader').balance, 290);
    assert.equal(byUserId.get('Urunner').balance, 100);
  } finally {
    await server.stop();
  }
});

test('uses the post-close builder price as the primary settlement price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gpost-close-price');

    await postWebhook(server.baseUrl, [
      creditEvent('Uopener-post-close', 200, 'm-credit-post-close-opener', 1710000180000),
      creditEvent('Uaccepter-post-close', 200, 'm-credit-post-close-accepter', 1710000180001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-post-close-open', text: 'เปิด กอดก้อนเมฆ 300-320' },
        timestamp: 1710000181000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uopener-post-close' },
        message: { type: 'text', id: 'm-post-close-trade', text: 'ชล100' },
        timestamp: 1710000182000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uaccepter-post-close' },
        message: { type: 'text', id: 'm-post-close-accept', quotedMessageId: 'm-post-close-trade', text: 'ต' },
        timestamp: 1710000183000
      },
      confirmPairEvent('Gpost-close-price', 'Uopener-post-close', 'm-post-close-accept', 'm-post-close-confirm', 1710000183500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-post-close-close', text: 'ปิด' },
        timestamp: 1710000184000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-post-close-price', text: 'ราคาช่าง 350-380' },
        timestamp: 1710000185000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-post-close-result-1', text: 'แจ้งผล 340' },
        timestamp: 1710000186000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gpost-close-price', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-post-close-result-2', text: 'แจ้งผล 340' },
        timestamp: 1710000187000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].priceRawUsed, '350-380');
    assert.equal(wounds[0].winningSide, 'chang_yang');
    assert.equal(wounds[0].winnerUserId, 'Uaccepter-post-close');
    assert.equal(wounds[0].loserUserId, 'Uopener-post-close');
    assert.equal(wounds[0].settlementStatus, 'settled');

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds[0].priceRaw, '350-380');
    assert.equal(rounds[0].resultIcon, '❌');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('Uaccepter-post-close').balance, 290);
    assert.equal(byUserId.get('Uopener-post-close').balance, 100);
  } finally {
    await server.stop();
  }
});

test('settles a result inside the builder price as a draw without changing balances', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsettle-draw');

    await postWebhook(server.baseUrl, [
      creditEvent('Urunner', 200, 'm-credit-draw-runner', 1710000090000),
      creditEvent('Ufader', 200, 'm-credit-draw-fader', 1710000090001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-draw-open', text: 'เปิด ส.รุ่งตะวัน 320-360' },
        timestamp: 1710000091000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Urunner' },
        message: { type: 'text', id: 'm-settle-draw-trade', text: 'ชล100' },
        timestamp: 1710000092000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Ufader' },
        message: { type: 'text', id: 'm-settle-draw-accept', quotedMessageId: 'm-settle-draw-trade', text: 'ต' },
        timestamp: 1710000093000
      },
      confirmPairEvent('Gsettle-draw', 'Urunner', 'm-settle-draw-accept', 'm-settle-draw-confirm', 1710000093500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-draw-close', text: 'ปิด' },
        timestamp: 1710000094000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-draw-result-1', text: 'แจ้งผล 340' },
        timestamp: 1710000095000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-draw', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-draw-result-2', text: 'แจ้งผล 340' },
        timestamp: 1710000096000
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].settlementStatus, 'draw');
    assert.equal(wounds[0].winnerUserId, '');
    assert.equal(wounds[0].loserUserId, '');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('Urunner').balance, 200);
    assert.equal(byUserId.get('Ufader').balance, 200);
  } finally {
    await server.stop();
  }
});

test('settles signed adjustable ไล่ keywords against the adjusted builder price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsettle-adjusted-dai');

    await postWebhook(server.baseUrl, [
      creditEvent('UadjustedDaiOpen', 500, 'm-credit-adjusted-dai-open', 1710000097000),
      creditEvent('UadjustedDaiAccept', 500, 'm-credit-adjusted-dai-accept', 1710000097001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-open', text: 'เปิด ส.ไพศาล' },
        timestamp: 1710000097100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'UadjustedDaiOpen' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-trade', text: '-10ล300' },
        timestamp: 1710000097200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'UadjustedDaiAccept' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-accept', quotedMessageId: 'm-settle-adjusted-dai-trade', text: 'ต' },
        timestamp: 1710000097300
      },
      confirmPairEvent(
        'Gsettle-adjusted-dai',
        'UadjustedDaiOpen',
        'm-settle-adjusted-dai-accept',
        'm-settle-adjusted-dai-confirm',
        1710000097350
      ),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-close', text: 'ปิด' },
        timestamp: 1710000097400
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-price', text: 'ราคาช่าง 340-375' },
        timestamp: 1710000097500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-result-1', text: 'แจ้งผล 370' },
        timestamp: 1710000097600
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-dai', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-dai-result-2', text: 'แจ้งผล 370' },
        timestamp: 1710000097700
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].openKeyword, '-10ล');
    assert.equal(wounds[0].priceAdjustment, -10);
    assert.equal(wounds[0].priceRawUsed, '330-365');
    assert.equal(wounds[0].settlementStatus, 'settled');
    assert.equal(wounds[0].winningSide, 'chang_dai');
    assert.equal(wounds[0].winnerUserId, 'UadjustedDaiOpen');
    assert.equal(wounds[0].loserUserId, 'UadjustedDaiAccept');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('UadjustedDaiOpen').balance, 770);
    assert.equal(byUserId.get('UadjustedDaiAccept').balance, 200);
  } finally {
    await server.stop();
  }
});

test('settles positive signed adjustable ถอย keywords against the adjusted builder price', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsettle-adjusted-yang');

    await postWebhook(server.baseUrl, [
      creditEvent('UadjustedYangOpen', 500, 'm-credit-adjusted-yang-open', 1710000098000),
      creditEvent('UadjustedYangAccept', 500, 'm-credit-adjusted-yang-accept', 1710000098001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-open', text: 'เปิด ส.ไพศาล' },
        timestamp: 1710000098100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'UadjustedYangOpen' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-trade', text: '+10ถ300' },
        timestamp: 1710000098200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'UadjustedYangAccept' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-accept', quotedMessageId: 'm-settle-adjusted-yang-trade', text: 'ต' },
        timestamp: 1710000098300
      },
      confirmPairEvent(
        'Gsettle-adjusted-yang',
        'UadjustedYangOpen',
        'm-settle-adjusted-yang-accept',
        'm-settle-adjusted-yang-confirm',
        1710000098350
      ),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-close', text: 'ปิด' },
        timestamp: 1710000098400
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-price', text: 'ราคาช่าง 340-375' },
        timestamp: 1710000098500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-result-1', text: 'แจ้งผล 345' },
        timestamp: 1710000098600
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsettle-adjusted-yang', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-settle-adjusted-yang-result-2', text: 'แจ้งผล 345' },
        timestamp: 1710000098700
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds[0].openKeyword, '+10ถ');
    assert.equal(wounds[0].priceAdjustment, 10);
    assert.equal(wounds[0].priceRawUsed, '350-385');
    assert.equal(wounds[0].settlementStatus, 'settled');
    assert.equal(wounds[0].winningSide, 'chang_yang');
    assert.equal(wounds[0].winnerUserId, 'UadjustedYangOpen');
    assert.equal(wounds[0].loserUserId, 'UadjustedYangAccept');

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('UadjustedYangOpen').balance, 770);
    assert.equal(byUserId.get('UadjustedYangAccept').balance, 200);
  } finally {
    await server.stop();
  }
});

test('detects a group unsend event and builds a group notification', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'G5', userId: 'Ucancel' },
        message: { type: 'text', id: 'm-cancel-target', text: 'ล1500' },
        timestamp: 1710000000000
      },
      {
        type: 'unsend',
        source: { type: 'group', groupId: 'G5', userId: 'Ucancel' },
        unsend: { messageId: 'm-cancel-target' },
        timestamp: 1710000019240
      },
      {
        type: 'unsend',
        source: { type: 'user', userId: 'Ucancel' },
        unsend: { messageId: 'm-private-target' },
        timestamp: 1710000020000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const unsendLog = logs.find((log) => log.unsendDetected);

    assert.equal(Boolean(unsendLog), true);
    assert.equal(unsendLog.groupId, 'G5');
    assert.equal(unsendLog.unsendMessageId, 'm-cancel-target');
    assert.equal(unsendLog.cancelledMessage, 'ล1500');
    assert.equal(unsendLog.unsendNotification.includes('พบการยกเลิกข้อความ'), true);
    assert.equal(unsendLog.unsendNotification.includes('ล1500'), true);
    assert.equal(logs.filter((log) => log.unsendDetected).length, 1);
  } finally {
    await server.stop();
  }
});

test('saves a queue list posted by a group admin', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ บ้านคุ้ม ต.คูเมือง',
      'อ.มหาชนะชัย จ.ยโสธร',
      '4  พฤษภาคม  2569',
      '',
      'กอดก้อนเมฆ',
      'น้องเหมียว',
      'ส.เจริญสายใจ',
      'กุ้งเจริญทรัพย์',
      '',
      'หมายเหตุคิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'G6');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'G6', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-list', text: queueText },
        timestamp: 1710000001000
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, 'บ้านคุ้ม ต.คูเมือง อ.มหาชนะชัย จ.ยโสธร');
    assert.equal(queueLists[0].dateText, '4 พฤษภาคม 2569');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      ['กอดก้อนเมฆ', 'น้องเหมียว', 'ส.เจริญสายใจ', 'กุ้งเจริญทรัพย์']
    );
    assert.equal(queueLists[0].note, 'หมายเหตุคิวจุดอาจมีการเปลี่ยนแปลง');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.ok(queueListLog);
    assert.deepEqual(queueListLog.queueListReplyTexts, [
      'คิวจุด✅\n\nกอดก้อนเมฆ\nน้องเหมียว\nส.เจริญสายใจ\nกุ้งเจริญทรัพย์'
    ]);
  } finally {
    await server.stop();
  }
});

test('saves a queue list when only the first line is the queue keyword', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ',
      '🚀จรวดอีสาน๙๙🚀',
      '📍 คิวจุด บ้านคุ้ม',
      '',
      'น้องบอม(20-60) 380✅✅',
      'ฟ้าสีทอง(30-80) 313❌❌',
      'กุ้งเจริญทรัพย์(40-70) 355⛔⛔',
      'เบริดอาค้า',
      'ส.กวินท์',
      'หนุ่ม ก.ท.ม.'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-keyword-only', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-keyword-only', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-keyword-only', text: queueText },
        timestamp: 1710000090000
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, '🚀จรวดอีสาน๙๙🚀 📍 คิวจุด บ้านคุ้ม');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      [
        'น้องบอม(20-60) 380✅✅',
        'ฟ้าสีทอง(30-80) 313❌❌',
        'กุ้งเจริญทรัพย์(40-70) 355⛔⛔',
        'เบริดอาค้า',
        'ส.กวินท์',
        'หนุ่ม ก.ท.ม.'
      ]
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.deepEqual(queueListLog.queueListReplyTexts, [
      'คิวจุด✅\n\nน้องบอม(20-60) 380✅✅\nฟ้าสีทอง(30-80) 313❌❌\nกุ้งเจริญทรัพย์(40-70) 355⛔⛔\nเบริดอาค้า\nส.กวินท์\nหนุ่ม ก.ท.ม.'
    ]);
  } finally {
    await server.stop();
  }
});

test('saves a numbered queue list without a blank line before items', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ',
      '🐸อึ่งไข่บั้งไฟมกาโชค🐸',
      '🌟🚀ที่นี่บ้านคำผักหนาม💯🚀🌟',
      '------------------------------',
      '1.บั้งไฟล้านชาอัมพร 8" บวก +50 วิ🔥',
      '2.แอ็ดเทวดา 1',
      '3.ศ.ราชวงศ์',
      '4.ส.พรพิมล',
      '5.ธรรมยุ่น',
      '6. ทองภัคดี 1',
      '20. โล่เงิน',
      '24.ส.แสงสว่าง'
    ].join('\n') + '\n';

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-numbered-no-blank', 'Uadmin', 'บ้านคำผักหนาม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-numbered-no-blank', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-numbered-no-blank', text: queueText },
        timestamp: 1710000090500
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, '🐸อึ่งไข่บั้งไฟมกาโชค🐸 🌟🚀ที่นี่บ้านคำผักหนาม💯🚀🌟');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      [
        'บั้งไฟล้านชาอัมพร 8" บวก +50 วิ🔥',
        'แอ็ดเทวดา 1',
        'ศ.ราชวงศ์',
        'ส.พรพิมล',
        'ธรรมยุ่น',
        'ทองภัคดี 1',
        'โล่เงิน',
        'ส.แสงสว่าง'
      ]
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.deepEqual(queueListLog.queueListReplyTexts, [
      'คิวจุด✅\n\nบั้งไฟล้านชาอัมพร 8" บวก +50 วิ🔥\nแอ็ดเทวดา 1\nศ.ราชวงศ์\nส.พรพิมล\nธรรมยุ่น\nทองภัคดี 1\nโล่เงิน\nส.แสงสว่าง'
    ]);
  } finally {
    await server.stop();
  }
});

test('saves a numbered queue list without a title and keeps footer as note', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ',
      '1.แอ็ดเทวดา',
      '2.ศ.ราชวงค์',
      '3.ส.พรพิมล',
      '4.นครเสาเล้า',
      '5.ทองภักดี',
      '6.สิงห์บึงบอก',
      '7.เทพพนม',
      '8.ปุ๋ยเมฆ',
      '9.กะทิทองคำ',
      '10.ส.กวิน+หนึ่งลำปาง',
      '11.เบิกฟ้านครแก ท่อ6"',
      '12.ครูทับเบิกฟ้า',
      '13.พรพระแก้ว1',
      '14.ลูกเจ้าพ่อเมืองแสน',
      '15.พรพระแก้ว2',
      '16.สางเทพ',
      '17.ศีรินภา',
      '18.ควายเผือก',
      '19.วัยรุ่นพนมไพร',
      '20.ส.สิ่งใจ',
      '',
      '📍',
      'ตุลาการกะทิถอยฟ้า+พรายด่าน้อยเสียงสวรรค์',
      '          (งานประเพณีฟีรุกที่ยิ่ง)'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-numbered-titleless', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-numbered-titleless', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-numbered-titleless', text: queueText },
        timestamp: 1710000090750
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, '');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      [
        'แอ็ดเทวดา',
        'ศ.ราชวงค์',
        'ส.พรพิมล',
        'นครเสาเล้า',
        'ทองภักดี',
        'สิงห์บึงบอก',
        'เทพพนม',
        'ปุ๋ยเมฆ',
        'กะทิทองคำ',
        'ส.กวิน+หนึ่งลำปาง',
        'เบิกฟ้านครแก ท่อ6"',
        'ครูทับเบิกฟ้า',
        'พรพระแก้ว1',
        'ลูกเจ้าพ่อเมืองแสน',
        'พรพระแก้ว2',
        'สางเทพ',
        'ศีรินภา',
        'ควายเผือก',
        'วัยรุ่นพนมไพร',
        'ส.สิ่งใจ'
      ]
    );
    assert.equal(
      queueLists[0].note,
      '📍\nตุลาการกะทิถอยฟ้า+พรายด่าน้อยเสียงสวรรค์\n(งานประเพณีฟีรุกที่ยิ่ง)'
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.equal(queueListLog.queueListItemCount, 20);
    assert.match(queueListLog.queueListReplyTexts[0], /^คิวจุด✅\n\nแอ็ดเทวดา\nศ\.ราชวงค์/);
    assert.equal(queueListLog.queueListReplyTexts[0].includes('ตุลาการกะทิถอยฟ้า'), false);
  } finally {
    await server.stop();
  }
});

test('saves an unnumbered queue list before a note without requiring a blank header split', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ',
      'โดนทองคำ',
      'น้องมิตร',
      'กอดเสาเอียง',
      'เทพศรี',
      'ข้าวการ',
      'น้องพี่โกซี่',
      'มหาเทพ',
      '',
      'หมายเหตุ คิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-unnumbered-note', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-unnumbered-note', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-unnumbered-note', text: queueText },
        timestamp: 1710000090775
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, '');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      ['โดนทองคำ', 'น้องมิตร', 'กอดเสาเอียง', 'เทพศรี', 'ข้าวการ', 'น้องพี่โกซี่', 'มหาเทพ']
    );
    assert.equal(queueLists[0].note, 'หมายเหตุ คิวจุดอาจมีการเปลี่ยนแปลง');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.ok(queueListLog);
    assert.equal(queueListLog.queueListItemCount, 7);
    assert.match(queueListLog.queueListReplyTexts[0], /^คิวจุด✅\n\nโดนทองคำ\nน้องมิตร/);
  } finally {
    await server.stop();
  }
});

test('saves an unnumbered queue list before an asterisk queue-change note', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ',
      'โชคประชาวัน 385✅✅',
      'แหลมเจริญ 395✅✅',
      'จอมอภิหาร 305❌❌',
      'สายน้ำเกลือ 355✅✅',
      'น้องเมษา 290❌❌',
      'เพชรวารี 710 ชมต 410✅',
      '',
      '*คิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-asterisk-note', 'Uadmin', 'ทดสอบ');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-asterisk-note', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-asterisk-note', text: queueText },
        timestamp: 1710000090785
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      [
        'โชคประชาวัน 385✅✅',
        'แหลมเจริญ 395✅✅',
        'จอมอภิหาร 305❌❌',
        'สายน้ำเกลือ 355✅✅',
        'น้องเมษา 290❌❌',
        'เพชรวารี 710 ชมต 410✅'
      ]
    );
    assert.equal(queueLists[0].note, '*คิวจุดอาจมีการเปลี่ยนแปลง');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueListLog = logs.find((log) => log.queueListSaved);
    assert.ok(queueListLog);
    assert.match(queueListLog.queueListReplyTexts[0], /โชคประชาวัน 385✅✅/);
    assert.equal(queueListLog.queueListReplyTexts[0].includes('*คิวจุดอาจมีการเปลี่ยนแปลง'), false);
  } finally {
    await server.stop();
  }
});

test('replies with queue list guidance when queue list cannot be parsed', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-invalid-form', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-invalid-form', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-invalid-form', text: 'คิวจุดรายการ\n\n📍\nยังไม่มีรายชื่อคิว' },
        timestamp: 1710000090800
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 0);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const failedLog = logs.find((log) => log.queueListFailed);
    assert.ok(failedLog);
    assert.equal(failedLog.queueListSaved, false);
    assert.equal(failedLog.queueListError, 'missing_items');
    assert.match(failedLog.queueListReplyTexts[0], /คิวไม่ติด/);
    assert.match(failedLog.queueListReplyTexts[0], /ยังไม่เจอรายชื่อคิว/);
    assert.match(failedLog.queueListReplyTexts[0], /1\.ชื่อคิว/);
  } finally {
    await server.stop();
  }
});

test('ignores numbered queue announcements without a bot queue keyword', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-missing-keyword', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-missing-keyword', userId: 'Uadmin' },
        message: {
          type: 'text',
          id: 'm-queue-missing-keyword',
          text: ['รายการวันนี้', '1.แอ็ดเทวดา', '2.ศ.ราชวงศ์', '3.ส.พรพิมล'].join('\n')
        },
        timestamp: 1710000090810
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 0);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.some((log) => log.queueListSaved), false);
    assert.equal(logs.some((log) => log.queueListFailed), false);
  } finally {
    await server.stop();
  }
});

test('replies with queue list guidance when a queue-intent message is missing the exact keyword', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-intent-missing-keyword', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-intent-missing-keyword', userId: 'Uadmin' },
        message: {
          type: 'text',
          id: 'm-queue-intent-missing-keyword',
          text: ['คิววันนี้', '1.แอ็ดเทวดา', '2.ศ.ราชวงศ์', '3.ส.พรพิมล'].join('\n')
        },
        timestamp: 1710000090811
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 0);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const failedLog = logs.find((log) => log.queueListFailed);
    assert.ok(failedLog);
    assert.equal(failedLog.queueListSaved, false);
    assert.equal(failedLog.queueListError, 'missing_keyword');
    assert.match(failedLog.queueListReplyTexts[0], /คิวไม่ติด/);
    assert.match(failedLog.queueListReplyTexts[0], /ขาดคำขึ้นต้น/);
    assert.match(failedLog.queueListReplyTexts[0], /คิวจุดรายการ/);
  } finally {
    await server.stop();
  }
});

test('saves a queue list when the first line is จุดรายการ', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'จุดรายการ',
      '🚀จรวดอีสาน๙๙🚀',
      '📍 คิวจุด บ้านคุ้ม',
      '',
      'น้องบอม(20-60) 380✅✅',
      'ฟ้าสีทอง(30-80) 313❌❌',
      'กุ้งเจริญทรัพย์(40-70) 355⛔⛔'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-short-keyword', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-short-keyword', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-short-keyword', text: queueText },
        timestamp: 1710000091000
      }
    ]);

    const queueLists = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueLists.length, 1);
    assert.equal(queueLists[0].title, '🚀จรวดอีสาน๙๙🚀 📍 คิวจุด บ้านคุ้ม');
    assert.deepEqual(
      queueLists[0].items.map((item) => item.name),
      [
        'น้องบอม(20-60) 380✅✅',
        'ฟ้าสีทอง(30-80) 313❌❌',
        'กุ้งเจริญทรัพย์(40-70) 355⛔⛔'
      ]
    );
  } finally {
    await server.stop();
  }
});

test('replies with the saved queue list from queue lookup keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'จุดรายการ',
      '🚀จรวดอีสาน๙๙🚀',
      '📍 คิวจุด บ้านคุ้ม',
      '',
      'น้องบอม(20-60) 380✅✅',
      'ฟ้าสีทอง(30-80) 313❌❌',
      'กุ้งเจริญทรัพย์(40-70) 355⛔⛔'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-lookup', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-lookup-save', text: queueText },
        timestamp: 1710000091100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup', userId: 'Umember' },
        message: { type: 'text', id: 'm-queue-lookup', text: 'คิวจุด' },
        timestamp: 1710000091200
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueLookupLog = logs.find((log) => log.queueLookupRequested);
    assert.ok(queueLookupLog);
    assert.equal(queueLookupLog.queueLookupFound, true);
    assert.deepEqual(queueLookupLog.queueLookupReplyTexts, [
      'คิวจุด✅\n\nน้องบอม(20-60) 380✅✅\nฟ้าสีทอง(30-80) 313❌❌\nกุ้งเจริญทรัพย์(40-70) 355⛔⛔'
    ]);
  } finally {
    await server.stop();
  }
});

test('queue lookup replies with the same result summary format after result confirmation', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');
    await clearJson(server.baseUrl, '/api/rounds');

    const queueText = [
      'คิวจุดรายการ',
      '🚀จรวดอีสาน๙๙🚀',
      '📍 คิวจุด บ้านคุ้ม',
      '',
      'กอดก้อนเมฆ',
      'น้องเหมียว'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-lookup-summary', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-save', text: queueText },
        timestamp: 1710000210000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-open', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000211000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-close', text: 'ปิด' },
        timestamp: 1710000212000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-price', text: 'ราคาช่าง 300-320' },
        timestamp: 1710000213000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-result-1', text: 'แจ้งผล 438' },
        timestamp: 1710000214000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-summary-result-2', text: 'แจ้งผล 438' },
        timestamp: 1710000215000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-summary', userId: 'Umember' },
        message: { type: 'text', id: 'm-queue-summary-lookup', text: 'คิวจุด' },
        timestamp: 1710000216000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueLookupLog = logs.find((log) => log.queueLookupRequested);
    assert.ok(queueLookupLog);
    assert.equal(queueLookupLog.queueLookupFound, true);
    assert.deepEqual(queueLookupLog.queueLookupReplyTexts, [
      'คิวจุด✅\n\nกอดก้อนเมฆ 300-320 438✅\nน้องเหมียว'
    ]);
  } finally {
    await server.stop();
  }
});

test('queue lookup appends opened rounds that are not in the saved queue list', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');
    await clearJson(server.baseUrl, '/api/rounds');

    const queueText = [
      'คิวจุดรายการ',
      'กอดก้อนเมฆ',
      'น้องเหมียว',
      '',
      '*คิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-lookup-extra-round', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-save', text: queueText },
        timestamp: 1710000217000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-open', text: 'เปิด ส.ไพศาล' },
        timestamp: 1710000218000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-close', text: 'ปิด' },
        timestamp: 1710000219000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-price', text: 'ราคาช่าง 340-375' },
        timestamp: 1710000220000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-result-1', text: 'แจ้งผล 370' },
        timestamp: 1710000221000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-queue-extra-result-2', text: 'แจ้งผล 370' },
        timestamp: 1710000222000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-extra-round', userId: 'Umember' },
        message: { type: 'text', id: 'm-queue-extra-lookup', text: 'คิวจุด' },
        timestamp: 1710000223000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueLookupLog = logs.find((log) => log.queueLookupRequested);
    assert.ok(queueLookupLog);
    assert.equal(queueLookupLog.queueLookupFound, true);
    assert.deepEqual(queueLookupLog.queueLookupReplyTexts, [
      'คิวจุด✅\n\nกอดก้อนเมฆ\nน้องเหมียว\nส.ไพศาล 340-375 370➖\n\n*คิวจุดอาจมีการเปลี่ยนแปลง'
    ]);
  } finally {
    await server.stop();
  }
});

test('queue lookup does not reuse old round results after a new queue list is posted', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/queue-lists');
    await clearJson(server.baseUrl, '/api/rounds');

    const oldQueueText = [
      'คิวจุดรายการ',
      'แอ็ดเทวดา',
      'ศ.ราชวงศ์'
    ].join('\n');
    const newQueueText = [
      'คิวจุดรายการ',
      '1.แอ็ดเทวดา',
      '2.ศ.ราชวงศ์',
      '3.หนุ่ม กทม'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gqueue-new-list-reset', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-old-save', text: oldQueueText },
        timestamp: 1710000310000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-open', text: 'เปิด แอ็ดเทวดา 330-450' },
        timestamp: 1710000311000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-close', text: 'ปิด' },
        timestamp: 1710000312000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-result-1', text: 'แจ้งผล 350' },
        timestamp: 1710000313000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-result-2', text: 'แจ้งผล 350' },
        timestamp: 1710000314000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-finish', text: 'สิ้นสุด' },
        timestamp: 1710000315000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-new-list-reset-new-save', text: newQueueText },
        timestamp: 1710000316000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-new-list-reset', userId: 'Umember' },
        message: { type: 'text', id: 'm-new-list-reset-lookup', text: 'คิวจุด' },
        timestamp: 1710000317000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueLookupLog = logs.find((log) => log.queueLookupRequested);
    assert.ok(queueLookupLog);
    assert.equal(queueLookupLog.queueLookupFound, true);

    const reply = queueLookupLog.queueLookupReplyTexts[0];
    assert.match(reply, /^คิวจุด✅/);
    assert.match(reply, /แอ็ดเทวดา/);
    assert.match(reply, /หนุ่ม กทม/);
    assert.equal(reply.includes('330-450'), false);
    assert.equal(reply.includes('350'), false);
  } finally {
    await server.stop();
  }
});

test('replies that no queue exists from queue lookup keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/queue-lists');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gqueue-lookup-empty', userId: 'Umember' },
        message: { type: 'text', id: 'm-queue-lookup-empty', text: 'คิว' },
        timestamp: 1710000091300
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const queueLookupLog = logs.find((log) => log.queueLookupRequested);
    assert.ok(queueLookupLog);
    assert.equal(queueLookupLog.queueLookupFound, false);
    assert.deepEqual(queueLookupLog.queueLookupReplyTexts, ['ตอนนี้ยังไม่มีคิวจุดครับ ✅\nรอแอดมินวางคิวก่อนนะครับ 🚀']);
  } finally {
    await server.stop();
  }
});

test('sends a closing report message after the last queue item is resulted', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ บ้านคุ้ม ต.คูเมือง',
      'อ.มหาชนะชัย จ.ยโสธร',
      '4  พฤษภาคม  2569',
      '',
      'สหายหลวง',
      'เฒ่าสำน้อย',
      '',
      'หมายเหตุคิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gfinish');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-queue-list', text: queueText },
        timestamp: 1710000060000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-open-1', text: 'เปิด สหายหลวง 305-340' },
        timestamp: 1710000061000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-close-1', text: 'ปิด' },
        timestamp: 1710000062000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-result-1a', text: 'แจ้งผล 370' },
        timestamp: 1710000063000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-result-1b', text: 'แจ้งผล 370' },
        timestamp: 1710000064000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-open-2', text: 'เปิด เฒ่าสำน้อย 330-370' },
        timestamp: 1710000065000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-close-2', text: 'ปิด' },
        timestamp: 1710000066000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-result-2a', text: 'แจ้งผล 390' },
        timestamp: 1710000067000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfinish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-finish-result-2b', text: 'แจ้งผล 390' },
        timestamp: 1710000068000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const firstResultLog = logs.find(
      (log) => log.queueAction === 'result_confirmed' && log.queueName === 'สหายหลวง'
    );
    const finalResultLog = logs.find(
      (log) => log.queueAction === 'result_confirmed' && log.queueName === 'เฒ่าสำน้อย'
    );

    assert.equal(firstResultLog.queueFinished, false);
    assert.equal(finalResultLog.queueFinished, true);
    assert.equal(finalResultLog.queueReplyTextCount, 3);
    assert.match(finalResultLog.queueFinishedReply, /^❌จบการรายงาน/);
    assert.match(finalResultLog.queueFinishedReply, /ส่งเลขบัญชีไว้หลังบ้านได้เลยนะครับ/);
  } finally {
    await server.stop();
  }
});

test('admin can send the final queue command to show the day summary and thanks', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/queue-lists');

    const queueText = [
      'คิวจุดรายการ บ้านคุ้ม ต.คูเมือง',
      'อ.มหาชนะชัย จ.ยโสธร',
      '4  พฤษภาคม  2569',
      '',
      'ศราช',
      'ฟีจะเอา',
      '',
      'หมายเหตุคิวจุดอาจมีการเปลี่ยนแปลง'
    ].join('\n');

    await registerAndBindAdmin(server.baseUrl, 'Gmanual-finish', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-queue-list', text: queueText },
        timestamp: 1710000070000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-open-1', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000071000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-close-1', text: 'ปิด' },
        timestamp: 1710000072000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-result-1a', text: 'แจ้งผล 400' },
        timestamp: 1710000073000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-result-1b', text: 'แจ้งผล 400' },
        timestamp: 1710000074000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-manual-finish-command', text: 'สิ้นสุด' },
        timestamp: 1710000075000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const finishLog = logs.find((log) => log.queueAction === 'queue_day_finished');

    assert.equal(finishLog.queueReplyTextCount, 2);
    assert.match(finishLog.queueReplyTexts[0], /^คิวจุด✅/);
    assert.match(finishLog.queueReplyTexts[0], /ศราช 350-380 400✅/);
    assert.match(finishLog.queueReplyTexts[1], /^❌จบการรายงาน/);
    assert.match(finishLog.queueReplyTexts[1], /ส่งเลขบัญชีไว้หลังบ้านได้เลยนะครับ/);

    const queueListsAfterFinish = await (await fetch(`${server.baseUrl}/api/queue-lists`)).json();
    assert.equal(queueListsAfterFinish.some((queueList) => queueList.groupId === 'Gmanual-finish'), false);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmanual-finish', userId: 'Umember' },
        message: { type: 'text', id: 'm-manual-finish-lookup', text: 'คิวจุด' },
        timestamp: 1710000076000
      }
    ]);

    const lookupLogs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const lookupLog = lookupLogs.find((log) => log.queueLookupRequested && log.groupId === 'Gmanual-finish');
    assert.equal(lookupLog.queueLookupFound, false);
    assert.deepEqual(lookupLog.queueLookupReplyTexts, ['ตอนนี้ยังไม่มีคิวจุดครับ ✅\nรอแอดมินวางคิวก่อนนะครับ 🚀']);
  } finally {
    await server.stop();
  }
});

test('does not allow an admin to control an unbound group', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/rounds');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-admin-unbound', text: 'I AM ADMIN : กลุ่มไทย1' },
        timestamp: 1710000000000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gunbound', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-open-unbound', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000001000
      }
    ]);

    const rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds.length, 0);
  } finally {
    await server.stop();
  }
});

test('replies when a group is bound successfully', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UbindReply' },
        message: { type: 'text', id: 'm-admin-bind-reply', text: 'I AM ADMIN : ทดสอบ1' },
        timestamp: 1710000079000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbind-reply', userId: 'UbindReply' },
        replyToken: 'reply-bind-success',
        message: { type: 'text', id: 'm-bind-reply', text: 'ผูกกลุ่ม : ทดสอบ' },
        timestamp: 1710000079001
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const bindLog = logs.find((log) => log.groupBindRequested);
    const adminLog = logs.find((log) => log.adminRegistered);

    assert.deepEqual(adminLog.adminReplyTexts, [
      [
        'เริ่มการผูกกลุ่ม: ทดสอบ',
        'ลำดับแอดมิน: 1',
        '',
        'ขั้นตอนต่อไป ให้เข้าไปในกลุ่ม LINE ที่ต้องการผูก แล้วพิมพ์:',
        'ผูกกลุ่ม : ทดสอบ'
      ].join('\n')
    ]);
    assert.equal(bindLog.groupBindSuccess, true);
    assert.equal(bindLog.boundGroupName, 'ทดสอบ');
    assert.deepEqual(bindLog.groupBindReplyTexts, [
      '✅ ผูกกลุ่มสำเร็จ: ทดสอบ\nกลุ่มนี้พร้อมใช้งานแล้วครับ'
    ]);
  } finally {
    await server.stop();
  }
});

test('replies with group admin mentions from group admin keywords', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');

    await registerAndBindAdmin(server.baseUrl, 'Gadmin-lookup', 'UadminPrimary', 'บ้านคุ้ม');
    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UadminSecondary' },
        message: { type: 'text', id: 'admin-Gadmin-lookup-UadminSecondary', text: 'I AM ADMIN : บ้านคุ้ม2' },
        timestamp: 1710000080040
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gadmin-lookup', userId: 'UadminSecondary' },
        message: { type: 'text', id: 'bind-Gadmin-lookup-UadminSecondary', text: 'ผูกกลุ่ม : บ้านคุ้ม' },
        timestamp: 1710000080041
      }
    ]);

    await postWebhook(server.baseUrl, ['แอดมิน', 'แอด', 'admin', 'Admin'].map((text, index) => ({
      type: 'message',
      source: { type: 'group', groupId: 'Gadmin-lookup', userId: `UmemberAdminLookup${index}` },
      replyToken: `reply-admin-lookup-${index}`,
      message: { type: 'text', id: `m-admin-lookup-${index}`, text },
      timestamp: 1710000080050 + index
    })));

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const lookupLogs = logs.filter((log) => log.groupAdminLookupRequested);

    assert.equal(lookupLogs.length, 4);

    for (const log of lookupLogs) {
      assert.equal(log.groupAdminReplyMessages.length, 1);
      const message = log.groupAdminReplyMessages[0];

      assert.equal(message.type, 'text');
      assert.match(message.text, /แอดมินกลุ่มนี้/);
      assert.match(message.text, /@แอดมิน1/);
      assert.match(message.text, /@แอดมิน2/);
      assert.deepEqual(
        message.mention.mentionees.map((mentionee) => mentionee.userId),
        ['UadminPrimary', 'UadminSecondary']
      );
    }
  } finally {
    await server.stop();
  }
});

test('registered group admin can open black account removal notice from black keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');

    await registerAndBindAdmin(server.baseUrl, 'Gblack-account', 'Uadmin', 'บ้านคุ้มส.กวินทร์');

    await postWebhook(server.baseUrl, ['เปิดบช.ดำ', 'เปิดดำ', 'เปิดบัญชีดำ'].map((text, index) => ({
      type: 'message',
      source: { type: 'group', groupId: 'Gblack-account', userId: 'Uadmin' },
      replyToken: `reply-black-account-open-${index}`,
      message: { type: 'text', id: `m-black-account-open-${index}`, text },
      timestamp: 1710000080060 + index
    })));

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const blackAccountLogs = logs.filter((log) => log.blackAccountAction === 'open_black_account_removal');

    assert.equal(blackAccountLogs.length, 3);
    for (const log of blackAccountLogs) {
      assert.deepEqual(log.blackAccountReplyTexts, [
        'เปิดลบบัญชีดำ(🟢)\nกลุ่ม บ้านคุ้มส.กวินทร์\nกรุณาส่งคอนแทคเพื่อลบบัญชีดำ'
      ]);
    }
  } finally {
    await server.stop();
  }
});

test('registered group admin can open white account notice from white keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');

    await registerAndBindAdmin(server.baseUrl, 'Gwhite-account', 'Uadmin', 'บ้านคุ้มส.กวินทร์');

    await postWebhook(server.baseUrl, ['เปิดขาว', 'เปิดบช.ขาว', 'เปิดบัญชีขาว'].map((text, index) => ({
      type: 'message',
      source: { type: 'group', groupId: 'Gwhite-account', userId: 'Uadmin' },
      replyToken: `reply-white-account-open-${index}`,
      message: { type: 'text', id: `m-white-account-open-${index}`, text },
      timestamp: 1710000080070 + index
    })));

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const whiteAccountLogs = logs.filter((log) => log.blackAccountAction === 'open_white_account');

    assert.equal(whiteAccountLogs.length, 3);
    for (const log of whiteAccountLogs) {
      assert.deepEqual(log.blackAccountReplyTexts, [
        'เปิดบัญชีขาว(⚪)\nกลุ่ม บ้านคุ้มส.กวินทร์\nกรุณาส่งคอนแทคเพื่อเปิดบัญชีขาว'
      ]);
    }
  } finally {
    await server.stop();
  }
});

test('blacklisted users cannot bet, request behind house, join invites, or withdraw', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/blacklist');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gblacklist-block', 'Uadmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      creditEvent('Ublacklisted', 500, 'm-blacklisted-credit', Date.parse('2024-03-09T11:00:00.000Z')),
      creditEvent('Ublack-ok', 500, 'm-black-ok-credit', Date.parse('2024-03-09T11:00:01.000Z')),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Uadmin' },
        replyToken: 'reply-blacklist-open-black',
        message: { type: 'text', id: 'm-blacklist-open-black', text: 'เปิดดำ' },
        timestamp: 1710000083000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Uadmin' },
        replyToken: 'reply-blacklist-add-mention',
        message: {
          type: 'text',
          id: 'm-blacklist-add-mention',
          text: '@Bad User',
          mention: {
            mentionees: [
              { index: 0, length: 9, userId: 'Ublacklisted' }
            ]
          }
        },
        timestamp: 1710000083001
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-blacklist-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000083002
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Ublacklisted' },
        replyToken: 'reply-blacklisted-behind',
        message: { type: 'text', id: 'm-blacklisted-behind', text: 'หลังบ้าน' },
        timestamp: 1710000083003
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Ublacklisted', displayName: 'Bad User' },
        message: { type: 'text', id: 'm-blacklisted-trade', text: 'ชล100' },
        timestamp: 1710000083004
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Ublack-ok' },
        message: { type: 'text', id: 'm-black-ok-accept', quotedMessageId: 'm-blacklisted-trade', text: 'ต' },
        timestamp: 1710000083005
      },
      confirmPairEvent('Gblacklist-block', 'Ublacklisted', 'm-black-ok-accept', 'm-blacklisted-confirm', 1710000083006),
      {
        type: 'message',
        source: { type: 'user', userId: 'Ublacklisted' },
        replyToken: 'reply-blacklisted-invite',
        message: { type: 'text', id: 'm-blacklisted-invite', text: 'เข้ากลุ่มแทง' },
        timestamp: 1710000083007
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'Ublacklisted' },
        replyToken: 'reply-blacklisted-withdraw',
        message: { type: 'text', id: 'm-blacklisted-withdraw', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T12:00:00.000Z')
      }
    ]);

    const blacklist = await (await fetch(`${server.baseUrl}/api/blacklist`)).json();
    assert.equal(blacklist.length, 1);
    assert.equal(blacklist[0].groupId, 'Gblacklist-block');
    assert.equal(blacklist[0].userId, 'Ublacklisted');
    assert.equal(blacklist[0].displayName, 'Bad User');

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 0);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.some((log) => log.blackAccountAction === 'blacklist_added'), true);
    assert.equal(logs.some((log) => log.userId === 'Ublacklisted' && log.behindHouseRequested), false);
    assert.equal(logs.some((log) => log.userId === 'Ublacklisted' && log.tradeKeyword), false);
    assert.equal(logs.some((log) => log.userId === 'Ublacklisted' && log.betGroupInviteRequested), false);

    const withdrawLog = logs.find((log) => log.userId === 'Ublacklisted' && log.message === 'ถอนยอดเงิน');
    assert.equal(withdrawLog.creditAction, 'blacklisted_withdraw_blocked');
    assert.match(JSON.stringify(withdrawLog.creditReplyMessages), /ระงับการถอน/);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Uadmin' },
        replyToken: 'reply-blacklist-open-white',
        message: { type: 'text', id: 'm-blacklist-open-white', text: 'เปิดขาว' },
        timestamp: 1710000084000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Uadmin' },
        replyToken: 'reply-blacklist-remove-mention',
        message: {
          type: 'text',
          id: 'm-blacklist-remove-mention',
          text: '@Bad User',
          mention: {
            mentionees: [
              { index: 0, length: 9, userId: 'Ublacklisted' }
            ]
          }
        },
        timestamp: 1710000084001
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gblacklist-block', userId: 'Ublacklisted' },
        replyToken: 'reply-blacklisted-behind-after-white',
        message: { type: 'text', id: 'm-blacklisted-behind-after-white', text: 'หลังบ้าน' },
        timestamp: 1710000084002
      }
    ]);

    const blacklistAfterWhite = await (await fetch(`${server.baseUrl}/api/blacklist`)).json();
    assert.equal(blacklistAfterWhite.length, 0);

    const logsAfterWhite = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logsAfterWhite.some((log) => log.blackAccountAction === 'blacklist_removed'), true);
    assert.equal(logsAfterWhite.some((log) => log.userId === 'Ublacklisted' && log.behindHouseRequested), true);
  } finally {
    await server.stop();
  }
});

test('removes an admin registration from a private IAMNOTADMIN command', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');

    await registerAndBindAdmin(server.baseUrl, 'Gremove-admin', 'UremoveAdmin', 'บ้านคุ้ม');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UremoveAdmin' },
        message: { type: 'text', id: 'm-remove-admin', text: 'IAMNOTADMIN : บ้านคุ้ม' },
        timestamp: 1710000080000
      }
    ]);

    const admins = await (await fetch(`${server.baseUrl}/api/admins`)).json();
    assert.equal(admins.some((admin) => admin.userId === 'UremoveAdmin' && admin.groupName === 'บ้านคุ้ม'), false);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const removeLog = logs.find((log) => log.adminRemoved);
    assert.equal(removeLog.adminRemovedGroupName, 'บ้านคุ้ม');
    assert.equal(removeLog.adminRemovedCount, 1);
  } finally {
    await server.stop();
  }
});

test('replies with payment account details from group account keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');

    await postWebhook(server.baseUrl, ['บช', 'เลข', 'เลขบัญชี', 'บัญชี', 'ลบช', 'เลขบช'].map((text, index) => ({
      type: 'message',
      source: { type: 'group', groupId: 'Ggroup-account', userId: `UgroupAccount${index}` },
      replyToken: `reply-group-account-${index}`,
      message: { type: 'text', id: `m-group-account-${index}`, text },
      timestamp: 1710000080500 + index
    })));

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const accountLogs = logs.filter((log) => log.groupPaymentAccountRequested);

    assert.equal(accountLogs.length, 6);

    for (const log of accountLogs) {
      assert.equal(log.behindHouseReplyTexts.length, 1);
      assert.match(log.behindHouseReplyTexts[0], /ช่องทางชำระเงิน/);
      assert.match(log.behindHouseReplyTexts[0], /9160581964 กรุงเทพ/);
      assert.match(log.behindHouseReplyTexts[0], /ภาณุเดช กุมแก้ว/);
      assert.match(log.behindHouseReplyTexts[0], /บัญชีนี้เท่านั้น/);
      assert.equal(log.behindHouseReplyMessages.length, 1);
      assert.equal(log.behindHouseReplyMessages[0].type, 'flex');
      assert.match(log.behindHouseReplyMessages[0].altText, /หลังบ้าน/);
    }
  } finally {
    await server.stop();
  }
});

test('replies with a compact LINE OA profile card when a group member asks for หลังบ้าน', async () => {
  const server = await startServer({
    LINE_OFFICIAL_ACCOUNT_IMAGE_URL: 'https://example.com/logo.png'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gbehind', userId: 'Umember' },
        replyToken: 'reply-behind-house',
        message: { type: 'text', id: 'm-behind-house', text: 'หลังบ้าน' },
        timestamp: 1710000081000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const linkLog = logs.find((log) => log.behindHouseRequested);

    assert.equal(linkLog.behindHouseLink, 'https://line.me/R/ti/p/@lamp-cover');
    assert.equal(linkLog.behindHouseReplyTexts.length, 1);
    assert.match(linkLog.behindHouseReplyTexts[0], /ช่องทางชำระเงิน/);
    assert.match(linkLog.behindHouseReplyTexts[0], /9160581964 กรุงเทพ/);
    assert.match(linkLog.behindHouseReplyTexts[0], /ภาณุเดช กุมแก้ว/);
    assert.match(linkLog.behindHouseReplyTexts[0], /บัญชีนี้เท่านั้น/);

    const replyMessages = linkLog.behindHouseReplyMessages || [];
    const texts = collectFlexTexts(replyMessages).join('\n');
    const actions = collectFlexActions(replyMessages);

    assert.equal(replyMessages[0].type, 'flex');
    assert.match(replyMessages[0].altText, /หลังบ้าน/);
    assert.match(texts, /Lamp cover\.OR/);
    assert.match(texts, /ดูโปรไฟล์/);
    assert.equal(actions.some((action) => action.type === 'uri' && action.uri === 'https://line.me/R/ti/p/@lamp-cover'), true);

    const bubble = replyMessages[0].contents;
    assert.equal(bubble.size, 'micro');
    assert.equal(bubble.body.paddingAll, '14px');

    const logoFrame = bubble.body.contents.find((item) => (
      item.type === 'box' && item.width === '52px' && item.height === '52px'
    ));
    assert.ok(logoFrame);
    assert.equal(logoFrame.cornerRadius, '26px');

    const logoImage = logoFrame.contents.find((item) => item.type === 'image');
    assert.equal(logoImage.url, 'https://example.com/logo.png');
    assert.equal(logoImage.size, 'full');
    assert.equal(logoImage.aspectRatio, '1:1');
    assert.equal(logoImage.aspectMode, 'cover');
  } finally {
    await server.stop();
  }
});

test('sends behind house payment text and profile card in one LINE reply call', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const blockStart = source.indexOf('if (behindHouseAction) {');
  const blockEnd = source.indexOf('if (betGroupInviteAction) {', blockStart);
  const behindHouseBlock = source.slice(blockStart, blockEnd);

  assert.notEqual(blockStart, -1);
  assert.notEqual(blockEnd, -1);
  assert.equal((behindHouseBlock.match(/replyToLine\(event\.replyToken/g) || []).length, 1);
  assert.match(behindHouseBlock, /behindHouseAction\.replyTexts/);
  assert.match(behindHouseBlock, /behindHouseAction\.replyMessages/);
});

test('replies with payment account details from private account keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');

    await postWebhook(server.baseUrl, ['บช', 'เลข', 'เลขบัญชี', 'บัญชี', 'ลบช'].map((text, index) => ({
      type: 'message',
      source: { type: 'user', userId: `Uaccount${index}` },
      replyToken: `reply-account-${index}`,
      message: { type: 'text', id: `m-account-${index}`, text },
      timestamp: 1710000082000 + index
    })));

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const accountLogs = logs.filter((log) => log.creditAction === 'payment_account');

    assert.equal(accountLogs.length, 5);

    for (const log of accountLogs) {
      assert.equal(log.creditReplyMessages.length, 2);
      assert.match(log.creditReplyMessages[0], /ช่องทางชำระเงิน/);
      assert.match(log.creditReplyMessages[0], /9160581964 กรุงเทพ/);
      assert.match(log.creditReplyMessages[0], /ภาณุเดช กุมแก้ว/);
      assert.match(log.creditReplyMessages[0], /บัญชีนี้เท่านั้น/);
      assert.equal(log.creditReplyMessages[1].type, 'flex');
      assert.match(log.creditReplyMessages[1].altText, /หลังบ้าน/);
    }
  } finally {
    await server.stop();
  }
});

test('replies with betting group invite links from the private menu keyword', async () => {
  const inviteText = [
    'เปิดฤดูกาลบั้งไฟแสน',
    'เข้ากลุ่มชมฟรี ส.กวิน',
    'มีกิจกรรมสำหรับพี่ๆที่มียอดการเล่น',
    '',
    'กลุ่ม1 คำผักหนาม',
    'https://line.me/ti/g/m4YA7PzmsE',
    '',
    'กลุ่ม2 หัวตะพาน',
    'https://line.me/ti/g/V79ffVz_7P'
  ].join('\\n');
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: '',
    BET_GROUP_INVITE_TEXT: inviteText
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UbetGroupInvite' },
        replyToken: 'reply-bet-group-invite',
        message: { type: 'text', id: 'm-bet-group-invite', text: 'เข้ากลุ่มแทง' },
        timestamp: 1710000082500
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const inviteLog = logs.find((log) => log.betGroupInviteRequested);

    assert.ok(inviteLog);
    assert.equal(inviteLog.betGroupInviteReplyTexts.length, 1);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /เปิดฤดูกาลบั้งไฟแสน/);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /กลุ่ม1 คำผักหนาม/);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /https:\/\/line\.me\/ti\/g\/m4YA7PzmsE/);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /กลุ่ม2 หัวตะพาน/);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /https:\/\/line\.me\/ti\/g\/V79ffVz_7P/);
  } finally {
    await server.stop();
  }
});

test('replies with betting group invite links from a private rich menu postback', async () => {
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: '',
    BET_GROUP_INVITE_TEXT: 'กลุ่ม1 ทดสอบ\\nhttps://line.me/ti/g/example'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    await postWebhook(server.baseUrl, [
      {
        type: 'postback',
        source: { type: 'user', userId: 'UbetGroupPostback' },
        replyToken: 'reply-bet-group-postback',
        postback: { data: 'action=bet_group_invite' },
        timestamp: 1710000082550
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const inviteLog = logs.find((log) => log.betGroupInviteRequested);

    assert.ok(inviteLog);
    assert.equal(inviteLog.betGroupInviteReplyTexts.length, 1);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /กลุ่ม1 ทดสอบ/);
    assert.match(inviteLog.betGroupInviteReplyTexts[0], /https:\/\/line\.me\/ti\/g\/example/);
  } finally {
    await server.stop();
  }
});

test('ignores join_group postback because the menu button should send text', async () => {
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: '',
    BET_GROUP_INVITE_TEXT: 'กลุ่ม1 ทดสอบ\\nhttps://line.me/ti/g/example'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    await postWebhook(server.baseUrl, [
      {
        type: 'postback',
        source: { type: 'user', userId: 'UlegacyJoinGroupPostback' },
        replyToken: 'reply-legacy-join-group',
        postback: { data: 'action=join_group' },
        timestamp: 1710000082575
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const inviteLog = logs.find((log) => log.betGroupInviteRequested);

    assert.equal(inviteLog, undefined);
  } finally {
    await server.stop();
  }
});

test('admin broadcast page updates the betting group invite message', async () => {
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: '',
    BET_GROUP_INVITE_TEXT: 'ข้อความเดิม'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    const unauthPage = await fetch(`${server.baseUrl}/broadcasts`, { redirect: 'manual' });
    assert.equal(unauthPage.status, 302);
    assert.match(unauthPage.headers.get('location') || '', /\/credits\/login/);

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = login.headers.get('set-cookie') || '';

    const page = await fetch(`${server.baseUrl}/broadcasts`, { headers: { cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /ตั้งค่าข้อความ/);
    assert.match(html, /name="inviteText"/);
    assert.match(html, /name="scheduledTime"/);
    assert.match(html, /href="\/credits"/);
    assert.doesNotMatch(html, /ใช้กับ keyword/);
    assert.doesNotMatch(html, /name="targetId"/);
    assert.doesNotMatch(html, /name="messageText"/);

    const inviteText = [
      'เปิดฤดูกาลบั้งไฟแสน',
      'กลุ่ม 1 บ้านคุ้ม',
      'https://line.me/ti/g/new-group'
    ].join('\n');
    const saveInvite = await fetch(`${server.baseUrl}/broadcasts/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie
      },
      body: new URLSearchParams({ inviteText }),
      redirect: 'manual'
    });
    assert.equal(saveInvite.status, 302);
    assert.match(saveInvite.headers.get('location') || '', /\/broadcasts/);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UbroadcastInvite' },
        replyToken: 'reply-broadcast-invite',
        message: { type: 'text', id: 'm-broadcast-invite', text: 'เข้ากลุ่มแทง' },
        timestamp: 1710000082600
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const inviteLog = logs.find((log) => log.betGroupInviteRequested);
    assert.ok(inviteLog);
    assert.equal(inviteLog.betGroupInviteReplyTexts[0], inviteText);
  } finally {
    await server.stop();
  }
});

test('scheduled broadcast sends the shared invite message once for the current day', async () => {
  const broadcastRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/v2/bot/message/broadcast') {
      broadcastRequests.push(JSON.parse(bodyText || '{}'));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl,
    BROADCAST_SCHEDULER_INTERVAL_MS: '50'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = login.headers.get('set-cookie') || '';
    const scheduledTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
    const inviteText = 'กลุ่ม1 ทดสอบ\nhttps://line.me/ti/g/example';

    const saveInvite = await fetch(`${server.baseUrl}/broadcasts/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie
      },
      body: new URLSearchParams({ inviteText }),
      redirect: 'manual'
    });
    assert.equal(saveInvite.status, 302);

    const createSchedule = await fetch(`${server.baseUrl}/broadcasts/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie
      },
      body: new URLSearchParams({
        title: 'เข้ากลุ่มทุกวัน',
        scheduledTime,
        enabled: 'on'
      }),
      redirect: 'manual'
    });
    assert.equal(createSchedule.status, 302);

    await waitForCondition(() => broadcastRequests.length > 0, 1200, 30);
    assert.equal(broadcastRequests.length, 1);
    assert.equal(broadcastRequests[0].messages[0].type, 'text');
    assert.match(broadcastRequests[0].messages[0].text, /กลุ่ม1 ทดสอบ/);

    await delay(180);
    assert.equal(broadcastRequests.length, 1);

    const settings = await (await fetch(`${server.baseUrl}/api/broadcast-settings`, { headers: { cookie } })).json();
    assert.equal(settings.schedules[0].lastSentDate.length, 10);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('uses the same saved invite message for rich menu text button and scheduled broadcast', async () => {
  const broadcastRequests = [];
  const replyRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const body = await readRequestJson(req);
    if (req.url === '/v2/bot/message/broadcast') {
      broadcastRequests.push(body);
    }
    if (req.url === '/v2/bot/message/reply') {
      replyRequests.push(body);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl,
    BROADCAST_SCHEDULER_INTERVAL_MS: '50'
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/broadcast-settings');

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = login.headers.get('set-cookie') || '';
    const inviteText = [
      'ข้อความเข้ากลุ่มจากหน้าตั้งค่า',
      'กลุ่ม1 บ้านคุ้ม',
      'https://line.me/ti/g/shared-button'
    ].join('\n');
    const scheduledTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());

    const saveInvite = await fetch(`${server.baseUrl}/broadcasts/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie
      },
      body: new URLSearchParams({ inviteText }),
      redirect: 'manual'
    });
    assert.equal(saveInvite.status, 302);

    const createSchedule = await fetch(`${server.baseUrl}/broadcasts/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        cookie
      },
      body: new URLSearchParams({
        title: 'ใช้ข้อความเดียวกัน',
        scheduledTime,
        enabled: 'on'
      }),
      redirect: 'manual'
    });
    assert.equal(createSchedule.status, 302);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UsharedInviteButton' },
        replyToken: 'reply-shared-invite-button',
        message: { type: 'text', id: 'm-shared-invite-button', text: 'เข้ากลุ่มแทง' },
        timestamp: 1710000082750
      }
    ]);

    await waitForCondition(() => replyRequests.length > 0, 1200, 30);
    await waitForCondition(() => broadcastRequests.length > 0, 1200, 30);

    assert.equal(replyRequests.length, 1);
    assert.equal(replyRequests[0].messages[0].type, 'text');
    assert.equal(replyRequests[0].messages[0].text, inviteText);
    assert.equal(broadcastRequests.length, 1);
    assert.equal(broadcastRequests[0].messages[0].type, 'text');
    assert.equal(broadcastRequests[0].messages[0].text, inviteText);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('ignores private chat C+ credit commands because credit requires a verified slip', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'Ucredit' },
        replyToken: 'reply-credit-1',
        message: { type: 'text', id: 'm-credit-1', text: 'C+100' },
        timestamp: 1710000000000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'Ucredit' },
        replyToken: 'reply-credit-2',
        message: { type: 'text', id: 'm-credit-2', text: 'C+200, C+59' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit', userId: 'Ucredit' },
        replyToken: 'reply-credit-group',
        message: { type: 'text', id: 'm-credit-group', text: 'C+999' },
        timestamp: 1710000002000
      }
    ]);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    assert.equal(credits.some((row) => row.userId === 'Ucredit'), false);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.some((log) => log.creditAction === 'credit_added'), false);
    assert.equal(logs.some((log) => log.message === 'C+100'), true);
  } finally {
    await server.stop();
  }
});

test('adds private chat credit from EasySlip verified image slips and rejects duplicates', async () => {
  const slipImage = Buffer.from('fake-slip-image');
  const easySlipRequests = [];
  const lineContentRequests = [];
  let easySlipCallCount = 0;

  const lineContentServer = await startHttpMock((req, res) => {
    lineContentRequests.push({
      url: req.url,
      authorization: req.headers.authorization
    });

    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(slipImage);
  });

  const easySlipServer = await startHttpMock(async (req, res) => {
    const body = await readRequestJson(req);
    easySlipCallCount += 1;
    easySlipRequests.push({
      url: req.url,
      authorization: req.headers.authorization,
      body
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        status: 200,
        data: {
          isDuplicate: easySlipCallCount > 1,
          transRef: 'BBL-TRX-001',
          rawSlip: {
            transRef: 'BBL-TRX-001',
            amount: {
              amount: 1250
            },
            receiver: {
              bank: {
                short: 'BBL'
              },
              account: {
                value: '1234567890'
              }
            }
          }
        }
      })
    );
  });

  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_CONTENT_API_BASE_URL: lineContentServer.baseUrl,
    EASYSLIP_API_KEY: 'easy-token',
    EASYSLIP_API_BASE_URL: easySlipServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UslipCredit' },
        replyToken: 'reply-slip-ok',
        message: { type: 'image', id: 'm-slip-ok' },
        timestamp: 1710000003000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UslipCredit' },
        replyToken: 'reply-slip-duplicate',
        message: { type: 'image', id: 'm-slip-duplicate' },
        timestamp: 1710000004000
      }
    ]);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const credit = credits.find((row) => row.userId === 'UslipCredit');
    assert.equal(credit.balance, 1250);
    assert.equal(credit.totalAdded, 1250);
    assert.equal(credit.transactions.length, 1);
    assert.equal(credit.transactions[0].type, 'slip_credit_added');
    assert.equal(credit.transactions[0].slipTransRef, 'BBL-TRX-001');

    assert.equal(lineContentRequests.length, 2);
    assert.match(lineContentRequests[0].url, /\/v2\/bot\/message\/m-slip-ok\/content$/);
    assert.equal(lineContentRequests[0].authorization, 'Bearer line-token');
    assert.equal(easySlipRequests.length, 2);
    assert.equal(easySlipRequests[0].url, '/verify/bank');
    assert.equal(easySlipRequests[0].authorization, 'Bearer easy-token');
    assert.equal(easySlipRequests[0].body.checkDuplicate, true);
    assert.match(easySlipRequests[0].body.base64, /^data:image\/jpeg;base64,/);
    assert.equal(easySlipRequests[0].body.base64.includes(slipImage.toString('base64')), true);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const successLog = logs.find((log) => log.creditAction === 'slip_credit_added');
    const duplicateLog = logs.find((log) => log.creditAction === 'slip_duplicate');
    const successTexts = collectFlexTexts(successLog.creditReplyMessages).join('\n');
    const duplicateTexts = collectFlexTexts(duplicateLog.creditReplyMessages).join('\n');

    assert.equal(successLog.slipTransRef, 'BBL-TRX-001');
    assert.equal(successLog.creditAmount, 1250);
    assert.match(successTexts, /1,250\.00/);
    assert.match(duplicateTexts, /สลิปนี้ถูกใช้แล้ว/);
  } finally {
    await server.stop();
    await lineContentServer.stop();
    await easySlipServer.stop();
  }
});

test('rejects concurrent duplicate slip credits when JSON storage is used', async () => {
  const slipImage = Buffer.from('same-slip-image');
  let easySlipCallCount = 0;
  const pendingEasySlipResponses = [];

  const lineContentServer = await startHttpMock((req, res) => {
    res.writeHead(200, { 'Content-Type': req.url.includes('/content') ? 'image/jpeg' : 'application/json' });
    res.end(req.url.includes('/content') ? slipImage : JSON.stringify({ success: true }));
  });

  const easySlipServer = await startHttpMock(async (req, res) => {
    await readRequestJson(req);
    easySlipCallCount += 1;
    pendingEasySlipResponses.push(res);

    if (pendingEasySlipResponses.length >= 2) {
      for (const pendingResponse of pendingEasySlipResponses.splice(0)) {
        pendingResponse.writeHead(200, { 'Content-Type': 'application/json' });
        pendingResponse.end(
          JSON.stringify({
            success: true,
            status: 200,
            data: {
              isDuplicate: false,
              transRef: 'BBL-RACE-001',
              rawSlip: {
                transRef: 'BBL-RACE-001',
                amount: { amount: 100 },
                receiver: { bank: { short: 'BBL' }, account: { value: '1234567890' } }
              }
            }
          })
        );
      }
    }
  });

  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_CONTENT_API_BASE_URL: lineContentServer.baseUrl,
    LINE_MESSAGING_API_BASE_URL: lineContentServer.baseUrl,
    EASYSLIP_API_KEY: 'easy-token',
    EASYSLIP_API_BASE_URL: easySlipServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');

    await Promise.all([
      postWebhook(server.baseUrl, [
        {
          type: 'message',
          source: { type: 'user', userId: 'UslipRace' },
          replyToken: 'reply-slip-race-one',
          message: { type: 'image', id: 'm-slip-race-one' },
          timestamp: 1710000005000
        }
      ]),
      postWebhook(server.baseUrl, [
        {
          type: 'message',
          source: { type: 'user', userId: 'UslipRace' },
          replyToken: 'reply-slip-race-two',
          message: { type: 'image', id: 'm-slip-race-two' },
          timestamp: 1710000005001
        }
      ])
    ]);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const credit = credits.find((row) => row.userId === 'UslipRace');
    assert.equal(credit.balance, 100);
    assert.equal(credit.totalAdded, 100);
    assert.equal(credit.transactions.length, 1);
    assert.equal(credit.transactions[0].slipTransRef, 'BBL-RACE-001');
    assert.equal(easySlipCallCount, 2);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.filter((log) => log.creditAction === 'slip_credit_added').length, 1);
    assert.equal(logs.filter((log) => log.creditAction === 'slip_duplicate').length, 1);
  } finally {
    await server.stop();
    await lineContentServer.stop();
    await easySlipServer.stop();
  }
});

test('builds balance, active wound, and closed withdraw cards from keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcredit2');

    await postWebhook(server.baseUrl, [
      creditEvent('Ubuyer', 120, 'm-credit-add-buyer', 1710000000000),
      creditEvent('Useller', 100, 'm-credit-add-seller', 1710000000500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit2', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-credit-round-open', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000001000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit2', userId: 'Ubuyer' },
        message: { type: 'text', id: 'm-credit-trade', text: 'ชล100' },
        timestamp: 1710000002000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit2', userId: 'Useller' },
        message: { type: 'text', id: 'm-credit-accept', quotedMessageId: 'm-credit-trade', text: 'ต' },
        timestamp: 1710000003000
      },
      confirmPairEvent('Gcredit2', 'Ubuyer', 'm-credit-accept', 'm-credit-confirm-pair', 1710000003500),
      {
        type: 'message',
        source: { type: 'user', userId: 'Ubuyer' },
        replyToken: 'reply-balance',
        message: { type: 'text', id: 'm-balance', text: 'เช็คยอดเงิน' },
        timestamp: 1710000004000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'Ubuyer' },
        replyToken: 'reply-active-wounds',
        message: { type: 'text', id: 'm-active-wounds', text: 'แผลที่กำลังติด' },
        timestamp: 1710000005000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'Ubuyer' },
        replyToken: 'reply-withdraw',
        message: { type: 'text', id: 'm-withdraw', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T09:00:00.000Z')
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const balanceLog = logs.find((log) => log.creditAction === 'balance_card');
    const activeLog = logs.find((log) => log.creditAction === 'active_wounds_card');
    const withdrawLog = logs.find((log) => log.creditAction === 'withdraw_closed');

    assert.equal(balanceLog.creditBalance, 120);
    assert.equal(balanceLog.activeWoundAmount, 100);
    assert.equal(activeLog.activeWoundCount, 1);
    assert.equal(activeLog.activeWoundAmount, 100);
    assert.equal(withdrawLog.withdrawableBalance, 20);
    assert.match(JSON.stringify(withdrawLog.creditReplyMessages), /18:00-08:00/);
  } finally {
    await server.stop();
  }
});

test('after 18:00 withdraw button opens a request form and stores withdrawal requests', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');

    fs.writeFileSync(CREDIT_FILE, JSON.stringify([
      {
        userId: 'UwithdrawUser',
        balance: 300,
        totalAdded: 300,
        transactions: [
          {
            id: 'seed-withdraw-user',
            type: 'test_credit_seed',
            amount: 300,
            rawText: 'seed',
            displayName: 'Bank Thirakan',
            pictureUrl: 'https://example.com/bank.jpg',
            balanceAfter: 300,
            timestamp: 1710000000000,
            time: '2024-03-09T16:00:00.000Z'
          }
        ],
        updatedTimestamp: 1710000000000,
        updatedTime: '2024-03-09T16:00:00.000Z'
      }
    ], null, 2), 'utf8');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UwithdrawUser' },
        replyToken: 'reply-withdraw-form',
        message: { type: 'text', id: 'm-withdraw-form', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T11:05:00.000Z')
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const withdrawLog = logs.find((log) => log.creditAction === 'withdraw_form');
    assert.ok(withdrawLog);
    assert.equal(withdrawLog.withdrawableBalance, 300);

    const actions = collectFlexActions(withdrawLog.creditReplyMessages);
    const formAction = actions.find((action) => action.type === 'uri' && /\/withdraw\/request\?token=/.test(action.uri || ''));
    assert.ok(formAction);
    const firstToken = new URL(formAction.uri).searchParams.get('token') || '';

    const formPage = await fetch(formAction.uri);
    const formHtml = await formPage.text();
    assert.equal(formPage.status, 200);
    assert.match(formHtml, /name="bankName"/);
    assert.match(formHtml, /name="accountNumber"/);
    assert.match(formHtml, /name="amount"/);
    assert.match(formHtml, /Bank Thirakan/);

    const invalidSubmit = await fetch(`${server.baseUrl}/withdraw/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: firstToken,
        bankName: 'กรุงเทพ',
        accountNumber: '1234567890',
        amount: '301'
      })
    });
    assert.equal(invalidSubmit.status, 400);

    const validSubmit = await fetch(`${server.baseUrl}/withdraw/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: firstToken,
        bankName: 'กรุงเทพ',
        accountNumber: '1234567890',
        amount: '300'
      }),
      redirect: 'manual'
    });
    assert.equal(validSubmit.status, 302);
    assert.match(validSubmit.headers.get('location') || '', /\/withdraw\/request\/success/);

    const duplicateFormPage = await fetch(formAction.uri);
    assert.equal(duplicateFormPage.status, 409);

    const duplicateTokenSubmit = await fetch(`${server.baseUrl}/withdraw/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: firstToken,
        bankName: 'กรุงเทพ',
        accountNumber: '1234567890',
        amount: '300'
      })
    });
    assert.equal(duplicateTokenSubmit.status, 409);
    const [createdWithdrawal] = JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8'));
    assert.ok(createdWithdrawal);
    assert.equal(JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8')).length, 1);

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UwithdrawUser' },
        replyToken: 'reply-withdraw-form-2',
        message: { type: 'text', id: 'm-withdraw-form-2', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T11:10:00.000Z')
      }
    ]);
    const secondLogs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const secondWithdrawLog = secondLogs.find((log) => log.timestamp === Date.parse('2024-03-09T11:10:00.000Z') && log.creditAction === 'withdraw_pending');
    assert.ok(secondWithdrawLog);
    assert.equal(secondWithdrawLog.withdrawalId, createdWithdrawal.id);
    const secondActions = collectFlexActions(secondWithdrawLog.creditReplyMessages);
    assert.equal(secondActions.some((action) => action.type === 'uri' && /\/withdraw\/request\?token=/.test(action.uri || '')), false);

    const freshPendingToken = createTestWithdrawalToken('UwithdrawUser');
    const pendingFormPage = await fetch(`${server.baseUrl}/withdraw/request?token=${encodeURIComponent(freshPendingToken)}`);
    assert.equal(pendingFormPage.status, 409);

    const pendingDuplicateSubmit = await fetch(`${server.baseUrl}/withdraw/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: freshPendingToken,
        bankName: 'กสิกร',
        accountNumber: '2223334445',
        amount: '50'
      })
    });
    assert.equal(pendingDuplicateSubmit.status, 409);
    assert.equal(JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8')).length, 1);

    const unauthWithdrawalsPage = await fetch(`${server.baseUrl}/withdrawals`, { redirect: 'manual' });
    assert.equal(unauthWithdrawalsPage.status, 302);
    assert.match(unauthWithdrawalsPage.headers.get('location') || '', /\/credits\/login/);

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

    const withdrawalsPage = await fetch(`${server.baseUrl}/withdrawals`, { headers: { cookie } });
    const withdrawalsHtml = await withdrawalsPage.text();
    assert.equal(withdrawalsPage.status, 200);
    assert.match(withdrawalsHtml, /ถอนเครดิต/);
    assert.match(withdrawalsHtml, /Bank Thirakan/);
    assert.match(withdrawalsHtml, /กรุงเทพ/);
    assert.match(withdrawalsHtml, /1234567890/);
    assert.match(withdrawalsHtml, /300\.00/);
    assert.match(withdrawalsHtml, /เสร็จสิ้น/);
    assert.match(withdrawalsHtml, /ยกเลิก/);
    assert.match(withdrawalsHtml, /name="reason"/);
    assert.match(withdrawalsHtml, /href="\/credits"/);
    assert.match(withdrawalsHtml, />หน้าเครดิต</);
    assert.doesNotMatch(withdrawalsHtml, />Refresh</);
    assert.ok(withdrawalsHtml.indexOf('href="/credits"') < withdrawalsHtml.indexOf('Logout'));

    const [pendingWithdrawal] = JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8'));
    assert.equal(pendingWithdrawal.status, 'pending');

    const complete = await fetch(`${server.baseUrl}/withdrawals/${encodeURIComponent(pendingWithdrawal.id)}/complete`, {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual'
    });
    assert.equal(complete.status, 302);
    assert.match(complete.headers.get('location') || '', /\/withdrawals/);

    const creditsAfterComplete = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const completedCredit = creditsAfterComplete.find((row) => row.userId === 'UwithdrawUser');
    assert.equal(completedCredit.balance, 0);
    assert.equal(completedCredit.transactions[0].type, 'withdrawal_completed');
    assert.equal(completedCredit.transactions[0].amount, -300);

    assert.deepEqual(JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8')), []);

    const withdrawalsAfterComplete = await fetch(`${server.baseUrl}/withdrawals`, { headers: { cookie } });
    const withdrawalsAfterCompleteHtml = await withdrawalsAfterComplete.text();
    assert.doesNotMatch(withdrawalsAfterCompleteHtml, /Bank Thirakan/);

    const duplicateComplete = await fetch(`${server.baseUrl}/withdrawals/${encodeURIComponent(pendingWithdrawal.id)}/complete`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal(duplicateComplete.status, 404);

    const creditsAfterDuplicate = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    assert.equal(creditsAfterDuplicate.find((row) => row.userId === 'UwithdrawUser').balance, 0);

    const completeLogs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const completeLog = completeLogs.find((log) => log.creditAction === 'withdrawal_completed');
    assert.ok(completeLog);
    assert.equal(completeLog.withdrawalId, pendingWithdrawal.id);
    assert.equal(completeLog.withdrawalPushStatus, 'skipped');
  } finally {
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');
    await server.stop();
  }
});

test('withdraw requests stay open until 08:00 Bangkok and then close with a notice', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');

    fs.writeFileSync(CREDIT_FILE, JSON.stringify([
      {
        userId: 'UwithdrawWindow',
        balance: 250,
        totalAdded: 250,
        transactions: [
          {
            id: 'seed-withdraw-window',
            type: 'test_credit_seed',
            amount: 250,
            rawText: 'seed',
            displayName: 'Window User',
            balanceAfter: 250,
            timestamp: 1710000000000,
            time: '2024-03-09T16:00:00.000Z'
          }
        ],
        updatedTimestamp: 1710000000000,
        updatedTime: '2024-03-09T16:00:00.000Z'
      }
    ], null, 2), 'utf8');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UwithdrawWindow' },
        replyToken: 'reply-withdraw-before-eight',
        message: { type: 'text', id: 'm-withdraw-before-eight', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T00:50:00.000Z')
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UwithdrawWindow' },
        replyToken: 'reply-withdraw-at-eight',
        message: { type: 'text', id: 'm-withdraw-at-eight', text: 'ถอนยอดเงิน' },
        timestamp: Date.parse('2024-03-09T01:00:00.000Z')
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const beforeEightLog = logs.find((log) => log.timestamp === Date.parse('2024-03-09T00:50:00.000Z'));
    const atEightLog = logs.find((log) => log.timestamp === Date.parse('2024-03-09T01:00:00.000Z'));
    assert.equal(beforeEightLog.creditAction, 'withdraw_form');
    assert.equal(atEightLog.creditAction, 'withdraw_closed');
    assert.match(JSON.stringify(atEightLog.creditReplyMessages), /18:00-08:00/);
  } finally {
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');
    await server.stop();
  }
});

test('admin can cancel a pending withdrawal with a reason without deducting credit', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');

    fs.writeFileSync(CREDIT_FILE, JSON.stringify([
      {
        userId: 'UwithdrawCancel',
        balance: 150,
        totalAdded: 150,
        transactions: [
          {
            id: 'seed-withdraw-cancel',
            type: 'test_credit_seed',
            amount: 150,
            rawText: 'seed',
            displayName: 'Cancel User',
            balanceAfter: 150,
            timestamp: 1710000000000,
            time: '2024-03-09T16:00:00.000Z'
          }
        ],
        updatedTimestamp: 1710000000000,
        updatedTime: '2024-03-09T16:00:00.000Z'
      }
    ], null, 2), 'utf8');

    const withdrawal = {
      id: 'withdraw-cancel-test',
      userId: 'UwithdrawCancel',
      displayName: 'Cancel User',
      pictureUrl: '',
      bankName: 'กรุงเทพ',
      accountNumber: '1112223334',
      amount: 100,
      availableBalance: 150,
      status: 'pending',
      createdTimestamp: 1710000000001,
      createdTime: '09/03/2567 23:00:00'
    };
    fs.writeFileSync(WITHDRAWAL_FILE, JSON.stringify([withdrawal], null, 2), 'utf8');

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

    const cancel = await fetch(`${server.baseUrl}/withdrawals/${encodeURIComponent(withdrawal.id)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ reason: 'เลขบัญชีไม่ถูกต้อง' }),
      redirect: 'manual'
    });
    assert.equal(cancel.status, 302);
    assert.match(cancel.headers.get('location') || '', /\/withdrawals/);

    assert.deepEqual(JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8')), []);

    const withdrawalsAfterCancel = await fetch(`${server.baseUrl}/withdrawals`, { headers: { cookie } });
    const withdrawalsAfterCancelHtml = await withdrawalsAfterCancel.text();
    assert.doesNotMatch(withdrawalsAfterCancelHtml, /Cancel User/);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    assert.equal(credits.find((row) => row.userId === 'UwithdrawCancel').balance, 150);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const cancelLog = logs.find((log) => log.creditAction === 'withdrawal_cancelled');
    assert.ok(cancelLog);
    assert.equal(cancelLog.withdrawalCancelReason, 'เลขบัญชีไม่ถูกต้อง');
    assert.equal(cancelLog.withdrawalPushStatus, 'skipped');
  } finally {
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');
    await server.stop();
  }
});

test('withdrawals page prunes processed requests and keeps only pending requests', async () => {
  const server = await startServer();

  try {
    fs.writeFileSync(WITHDRAWAL_FILE, JSON.stringify([
      {
        id: 'withdraw-done',
        userId: 'Udone',
        displayName: 'Done User',
        bankName: 'Bank A',
        accountNumber: '111',
        amount: 100,
        availableBalance: 100,
        status: 'completed',
        createdTimestamp: 1710000000000,
        createdTime: '09/03/2567 23:00:00'
      },
      {
        id: 'withdraw-cancelled',
        userId: 'Ucancelled',
        displayName: 'Cancelled User',
        bankName: 'Bank B',
        accountNumber: '222',
        amount: 200,
        availableBalance: 200,
        status: 'cancelled',
        createdTimestamp: 1710000001000,
        createdTime: '09/03/2567 23:00:01'
      },
      {
        id: 'withdraw-pending',
        userId: 'Upending',
        displayName: 'Pending User',
        bankName: 'Bank C',
        accountNumber: '333',
        amount: 300,
        availableBalance: 300,
        status: 'pending',
        createdTimestamp: 1710000002000,
        createdTime: '09/03/2567 23:00:02'
      }
    ], null, 2), 'utf8');

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

    const withdrawalsPage = await fetch(`${server.baseUrl}/withdrawals`, { headers: { cookie } });
    const html = await withdrawalsPage.text();
    assert.equal(withdrawalsPage.status, 200);
    assert.match(html, /Pending User/);
    assert.doesNotMatch(html, /Done User/);
    assert.doesNotMatch(html, /Cancelled User/);

    const withdrawals = JSON.parse(fs.readFileSync(WITHDRAWAL_FILE, 'utf8'));
    assert.equal(withdrawals.length, 1);
    assert.equal(withdrawals[0].id, 'withdraw-pending');
  } finally {
    fs.writeFileSync(WITHDRAWAL_FILE, '[]', 'utf8');
    await server.stop();
  }
});

test('credit flex cards do not attach quick reply buttons or point labels', () => {
  const source = fs.readFileSync('server.js', 'utf8');

  assert.equal(source.includes('quickReply'), false);
  assert.equal(source.includes('แต้ม'), false);
});

test('credits page requires login and supports manual top up by user name', async () => {
  const server = await startServer({ LINE_CHANNEL_ACCESS_TOKEN: '' });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/credits');

    fs.writeFileSync(CREDIT_FILE, JSON.stringify([
      {
        userId: 'UmanualPageUser',
        balance: 10,
        totalAdded: 10,
        transactions: [
          {
            id: 'seed-manual-page',
            type: 'test_credit_seed',
            amount: 10,
            rawText: 'seed',
            displayName: 'Bank Thirakan',
            pictureUrl: 'https://example.com/bank.jpg',
            balanceAfter: 10,
            timestamp: 1710000000000,
            time: '2024-03-09T16:00:00.000Z'
          }
        ],
        updatedTimestamp: 1710000000000,
        updatedTime: '2024-03-09T16:00:00.000Z'
      }
    ], null, 2), 'utf8');
    fs.writeFileSync('messages.json', JSON.stringify([
      {
        id: 'm-known-no-credit',
        groupId: 'Gknown',
        userId: 'UknownNoCredit',
        displayName: 'No Credit User',
        text: 'ชล100',
        timestamp: 1709999999000,
        time: '2024-03-09T15:59:59.000Z'
      }
    ], null, 2), 'utf8');

    const unauthPage = await fetch(`${server.baseUrl}/credits`, { redirect: 'manual' });
    assert.equal(unauthPage.status, 302);
    assert.match(unauthPage.headers.get('location') || '', /\/credits\/login/);

    const unauthManual = await fetch(`${server.baseUrl}/api/credits/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey: 'missing', amount: 50 })
    });
    assert.equal(unauthManual.status, 401);

    const login = await fetch(`${server.baseUrl}/credits/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'Admin', password: 'admin123' }),
      redirect: 'manual'
    });
    assert.equal(login.status, 302);

    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /lamp_credits_admin=/);

    const page = await fetch(`${server.baseUrl}/credits`, { headers: { cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Bank Thirakan/);
    assert.match(html, /No Credit User/);
    assert.match(html, /href="\/withdrawals"/);
    assert.match(html, />หน้าถอน</);
    assert.doesNotMatch(html, />Refresh</);
    assert.ok(html.indexOf('href="/withdrawals"') < html.indexOf('Logout'));
    assert.match(html, /placeholder="ค้นหาชื่อ"/);
    assert.match(html, /src="https:\/\/example\.com\/bank\.jpg"/);
    assert.match(html, /ยอดคงเหลือ/);
    assert.match(html, /10\.00/);
    assert.match(html, /0\.00/);
    assert.doesNotMatch(html, /href="\/credits\/login">Login/);
    assert.doesNotMatch(html, /href="\/logs">Logs/);
    assert.doesNotMatch(html, /UmanualPageUser/);
    assert.doesNotMatch(html, /UknownNoCredit/);
    assert.doesNotMatch(html, /Updated|User ID|Balance|Transactions|Latest Command/);

    const userKey = createCreditsAdminUserToken('UmanualPageUser');
    assert.ok(userKey);
    const noCreditUserKey = createCreditsAdminUserToken('UknownNoCredit');
    assert.ok(noCreditUserKey);
    assert.match(html, new RegExp(`name="userKey" value="${noCreditUserKey}"`));

    const manual = await fetch(`${server.baseUrl}/api/credits/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ userKey, amount: 50, note: 'manual fallback' })
    });
    const manualBody = await manual.json();
    assert.equal(manual.status, 200);
    assert.equal(manualBody.success, true);
    assert.equal(manualBody.balance, 60);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const credit = credits.find((row) => row.userId === 'UmanualPageUser');
    assert.equal(credit.balance, 60);
    assert.equal(credit.transactions[0].type, 'manual_credit_added');
    assert.equal(credit.transactions[0].manualNote, 'manual fallback');

    const manualKnownUser = await fetch(`${server.baseUrl}/api/credits/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ userKey: noCreditUserKey, amount: 25, note: 'known user fallback' })
    });
    const manualKnownUserBody = await manualKnownUser.json();
    assert.equal(manualKnownUser.status, 200);
    assert.equal(manualKnownUserBody.success, true);
    assert.equal(manualKnownUserBody.balance, 25);

    const updatedCredits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const knownCredit = updatedCredits.find((row) => row.userId === 'UknownNoCredit');
    assert.equal(knownCredit.balance, 25);
    assert.equal(knownCredit.transactions[0].displayName, 'No Credit User');
  } finally {
    await server.stop();
  }
});

test('reports JSON storage when MongoDB is not configured', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/storage`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.driver, 'json');
    assert.equal(body.mongoConnected, false);
  } finally {
    await server.stop();
  }
});

test('declares MongoDB storage configuration and dependency', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.equal(Boolean(packageJson.dependencies.mongodb), true);
  assert.match(source, /MONGODB_URI/);
  assert.match(source, /lamp_logs/);
  assert.match(source, /lamp_slips/);
});

test('blocks a new queue round until the previous round result is confirmed', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');

    await registerAndBindAdmin(server.baseUrl, 'Gflow');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-open-first', text: 'เปิด ป.ธนวัฒน์' },
        timestamp: 1710000010000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-close-first', text: 'ปิด' },
        timestamp: 1710000011000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-open-blocked', text: 'เปิด สหายหลวง' },
        timestamp: 1710000012000
      }
    ]);

    let rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].queueName, 'ป.ธนวัฒน์');
    assert.equal(rounds[0].status, 'closed');

    let logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const blockedLog = logs.find((log) => log.queueAction === 'round_open_blocked_pending_result');
    assert.equal(blockedLog.queueName, 'ป.ธนวัฒน์');
    assert.equal(blockedLog.blockedQueueName, 'สหายหลวง');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-result-first', text: 'แจ้งผล จาวทุกแผล' },
        timestamp: 1710000013000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-result-second', text: 'แจ้งผล จาวทุกแผล' },
        timestamp: 1710000014000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gflow', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-flow-open-second', text: 'เปิด สหายหลวง' },
        timestamp: 1710000015000
      }
    ]);

    rounds = await (await fetch(`${server.baseUrl}/api/rounds`)).json();
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].queueName, 'สหายหลวง');
    assert.equal(rounds[0].status, 'open');
    assert.equal(rounds[1].queueName, 'ป.ธนวัฒน์');
    assert.equal(rounds[1].status, 'resulted');
    assert.equal(rounds[1].result, 'จาวทุกแผล');
    assert.equal(rounds[1].resultIcon, '');

    logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.some((log) => log.queueAction === 'result_confirmation_requested' && log.result === 'จาวทุกแผล'), true);
    assert.equal(logs.some((log) => log.queueAction === 'result_confirmed' && log.result === 'จาวทุกแผล'), true);
  } finally {
    await server.stop();
  }
});

test('requires available credit before creating a wound and lets the next accepter pair', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcredit-gate');

    await postWebhook(server.baseUrl, [
      creditEvent('UopenerCredit', 170, 'm-credit-opener-170', 1710000020000),
      creditEvent('UpoorAccepter', 100, 'm-credit-poor-100', 1710000020001),
      creditEvent('UrichAccepter', 200, 'm-credit-rich-200', 1710000020002),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-gate', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-credit-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000021000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-gate', userId: 'UopenerCredit' },
        message: { type: 'text', id: 'm-credit-trade-170', text: 'ชล170' },
        timestamp: 1710000022000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-gate', userId: 'UpoorAccepter' },
        message: { type: 'text', id: 'm-credit-poor-accept', quotedMessageId: 'm-credit-trade-170', text: 'ต' },
        timestamp: 1710000023000
      },
      confirmPairEvent('Gcredit-gate', 'UopenerCredit', 'm-credit-poor-accept', 'm-credit-poor-confirm', 1710000023500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-gate', userId: 'UrichAccepter' },
        message: { type: 'text', id: 'm-credit-rich-accept', quotedMessageId: 'm-credit-trade-170', text: 'ต' },
        timestamp: 1710000024000
      },
      confirmPairEvent('Gcredit-gate', 'UopenerCredit', 'm-credit-rich-accept', 'm-credit-rich-confirm', 1710000024500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].openerUserId, 'UopenerCredit');
    assert.equal(wounds[0].accepterUserId, 'UrichAccepter');
    assert.equal(wounds[0].amount, '170');

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const rejectedLog = logs.find((log) => log.woundRejectedReason === 'insufficient_credit');
    assert.equal(rejectedLog.accepterUserId, 'UpoorAccepter');
    assert.equal(rejectedLog.requiredCredit, 170);
    assert.deepEqual(rejectedLog.insufficientCreditUsers, ['UpoorAccepter']);

    const createdLog = logs.find((log) => log.woundCreated);
    assert.equal(createdLog.woundNotificationTargets.length, 2);
  } finally {
    await server.stop();
  }
});

test('reserves active wound credit across multiple pairs', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcredit-reserve');

    await postWebhook(server.baseUrl, [
      creditEvent('UmultiOpener', 370, 'm-credit-multi-opener', 1710000030000),
      creditEvent('UacceptOne', 200, 'm-credit-accept-one', 1710000030001),
      creditEvent('UacceptTwo', 250, 'm-credit-accept-two', 1710000030002),
      creditEvent('UacceptThree', 250, 'm-credit-accept-three', 1710000030003),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-credit-reserve-open-round', text: 'เปิด กอดก้อนเมฆ' },
        timestamp: 1710000031000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UmultiOpener' },
        message: { type: 'text', id: 'm-credit-reserve-trade-170', text: 'ชล170' },
        timestamp: 1710000032000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UacceptOne' },
        message: { type: 'text', id: 'm-credit-reserve-accept-one', quotedMessageId: 'm-credit-reserve-trade-170', text: 'ต' },
        timestamp: 1710000033000
      },
      confirmPairEvent('Gcredit-reserve', 'UmultiOpener', 'm-credit-reserve-accept-one', 'm-credit-reserve-confirm-one', 1710000033500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UacceptTwo' },
        message: { type: 'text', id: 'm-credit-reserve-duplicate-accept', quotedMessageId: 'm-credit-reserve-trade-170', text: 'ต' },
        timestamp: 1710000034000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UmultiOpener' },
        message: { type: 'text', id: 'm-credit-reserve-trade-200', text: 'ชล200' },
        timestamp: 1710000035000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UacceptTwo' },
        message: { type: 'text', id: 'm-credit-reserve-accept-two', quotedMessageId: 'm-credit-reserve-trade-200', text: 'ต' },
        timestamp: 1710000036000
      },
      confirmPairEvent('Gcredit-reserve', 'UmultiOpener', 'm-credit-reserve-accept-two', 'm-credit-reserve-confirm-two', 1710000036500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UmultiOpener' },
        message: { type: 'text', id: 'm-credit-reserve-trade-1', text: 'ชล1' },
        timestamp: 1710000037000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gcredit-reserve', userId: 'UacceptThree' },
        message: { type: 'text', id: 'm-credit-reserve-accept-three', quotedMessageId: 'm-credit-reserve-trade-1', text: 'ต' },
        timestamp: 1710000038000
      },
      confirmPairEvent('Gcredit-reserve', 'UmultiOpener', 'm-credit-reserve-accept-three', 'm-credit-reserve-confirm-three', 1710000038500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 2);
    assert.deepEqual(
      wounds.map((wound) => [wound.openMessageId, wound.accepterUserId, wound.amount]).sort(),
      [
        ['m-credit-reserve-trade-170', 'UacceptOne', '170'],
        ['m-credit-reserve-trade-200', 'UacceptTwo', '200']
      ]
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const insufficientLog = logs.find((log) => log.woundRejectedReason === 'insufficient_credit');
    assert.deepEqual(insufficientLog.insufficientCreditUsers, ['UmultiOpener']);
    assert.equal(insufficientLog.requiredCredit, 1);
  } finally {
    await server.stop();
  }
});

test('allows split accepts on the same trade until available credit runs out', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gsplit-accept');

    await postWebhook(server.baseUrl, [
      creditEvent('UsplitOpener', 400, 'm-credit-split-opener', 1710000040000),
      creditEvent('UsplitAcceptOne', 100, 'm-credit-split-accept-one', 1710000040001),
      creditEvent('UsplitAcceptTwo', 300, 'm-credit-split-accept-two', 1710000040002),
      creditEvent('UsplitAcceptExtra', 100, 'm-credit-split-accept-extra', 1710000040003),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsplit-accept', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-split-round-open', text: 'เปิด เบริดอาค้า' },
        timestamp: 1710000041000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsplit-accept', userId: 'UsplitOpener' },
        message: { type: 'text', id: 'm-split-trade-400', text: '+5ถ400' },
        timestamp: 1710000042000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsplit-accept', userId: 'UsplitAcceptOne' },
        message: { type: 'text', id: 'm-split-accept-one', quotedMessageId: 'm-split-trade-400', text: 'ต100' },
        timestamp: 1710000043000
      },
      confirmPairEvent('Gsplit-accept', 'UsplitOpener', 'm-split-accept-one', 'm-split-confirm-one', 1710000043500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsplit-accept', userId: 'UsplitAcceptTwo' },
        message: { type: 'text', id: 'm-split-accept-two', quotedMessageId: 'm-split-trade-400', text: 'ต300' },
        timestamp: 1710000044000
      },
      confirmPairEvent('Gsplit-accept', 'UsplitOpener', 'm-split-accept-two', 'm-split-confirm-two', 1710000044500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gsplit-accept', userId: 'UsplitAcceptExtra' },
        message: { type: 'text', id: 'm-split-accept-extra', quotedMessageId: 'm-split-trade-400', text: 'ต100' },
        timestamp: 1710000045000
      },
      confirmPairEvent('Gsplit-accept', 'UsplitOpener', 'm-split-accept-extra', 'm-split-confirm-extra', 1710000045500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 2);
    assert.deepEqual(
      wounds.map((wound) => [wound.openMessageId, wound.accepterUserId, wound.amount, wound.requiredCredit]).sort(),
      [
        ['m-split-trade-400', 'UsplitAcceptOne', '100', 100],
        ['m-split-trade-400', 'UsplitAcceptTwo', '300', 300]
      ]
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.filter((log) => log.woundCreated).length, 2);
    const rejectedLog = logs.find(
      (log) => log.woundRejectedReason === 'insufficient_credit' && log.accepterUserId === 'UsplitAcceptExtra'
    );
    assert.ok(rejectedLog);
    assert.deepEqual(rejectedLog.insufficientCreditUsers, ['UsplitOpener']);
  } finally {
    await server.stop();
  }
});

test('replies why a second ชตย wound is rejected when reserved credit is too low', async () => {
  const replyRequests = [];
  const lineServer = await startHttpMock(async (req, res) => {
    const body = await readRequestJson(req);
    if (req.url === '/v2/bot/message/reply') {
      replyRequests.push(body);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  const server = await startServer({
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_MESSAGING_API_BASE_URL: lineServer.baseUrl
  });

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gfallback-reserve');

    await postWebhook(server.baseUrl, [
      creditEvent('UfallbackReserveOpener', 500, 'm-credit-fallback-reserve-opener', 1710000051000),
      creditEvent('UfallbackReserveAccepter', 500, 'm-credit-fallback-reserve-accepter', 1710000051001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-fallback-reserve-open-round', text: 'เปิด ทดสอบ' },
        timestamp: 1710000051100
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'UfallbackReserveOpener' },
        message: { type: 'text', id: 'm-fallback-reserve-trade-one', text: '330-360ล200ชตย' },
        timestamp: 1710000051200
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'UfallbackReserveAccepter' },
        message: { type: 'text', id: 'm-fallback-reserve-accept-one', quotedMessageId: 'm-fallback-reserve-trade-one', text: 'ต' },
        timestamp: 1710000051300
      },
      confirmPairEvent('Gfallback-reserve', 'UfallbackReserveOpener', 'm-fallback-reserve-accept-one', 'm-fallback-reserve-confirm-one', 1710000051400),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'UfallbackReserveOpener' },
        message: { type: 'text', id: 'm-fallback-reserve-trade-two', text: '350ล100ชตย' },
        timestamp: 1710000051500
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'UfallbackReserveAccepter' },
        message: { type: 'text', id: 'm-fallback-reserve-accept-two', quotedMessageId: 'm-fallback-reserve-trade-two', text: 'ต' },
        timestamp: 1710000051600
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gfallback-reserve', userId: 'UfallbackReserveOpener' },
        replyToken: 'reply-second-fallback-reject',
        message: { type: 'text', id: 'm-fallback-reserve-confirm-two', quotedMessageId: 'm-fallback-reserve-accept-two', text: 'ต' },
        timestamp: 1710000051700
      }
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 1);
    assert.equal(wounds[0].openMessageId, 'm-fallback-reserve-trade-one');
    assert.equal(wounds[0].requiredCredit, 400);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const rejectedLog = logs.find(
      (log) =>
        log.openMessageId === 'm-fallback-reserve-trade-two' &&
        log.woundRejectedReason === 'insufficient_credit'
    );
    assert.ok(rejectedLog);
    assert.equal(rejectedLog.requiredCredit, 200);
    assert.equal(rejectedLog.openerAvailableCredit, 100);
    assert.equal(rejectedLog.accepterAvailableCredit, 100);
    assert.deepEqual(
      rejectedLog.insufficientCreditUsers.sort(),
      ['UfallbackReserveAccepter', 'UfallbackReserveOpener'].sort()
    );

    const rejectReply = replyRequests.find((request) => request.replyToken === 'reply-second-fallback-reject');
    assert.ok(rejectReply);
    const replyText = rejectReply.messages?.[0]?.text || '';
    assert.match(replyText, /แผลไม่ติด/);
    assert.match(replyText, /เครดิตที่ถอนได้ไม่พอ/);
    assert.match(replyText, /200\.00/);
    assert.match(replyText, /100\.00/);
    assert.match(replyText, /ชตย/);
  } finally {
    await server.stop();
    await lineServer.stop();
  }
});

test('allows the same opener trade to pair with multiple accepters when credit remains', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gmulti-accept-same-trade');

    await postWebhook(server.baseUrl, [
      creditEvent('UmultiSameOpener', 400, 'm-credit-multi-same-opener', 1710000046000),
      creditEvent('UmultiSameAcceptOne', 200, 'm-credit-multi-same-accept-one', 1710000046001),
      creditEvent('UmultiSameAcceptTwo', 200, 'm-credit-multi-same-accept-two', 1710000046002),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmulti-accept-same-trade', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-multi-same-round-open', text: 'เปิด ศราช' },
        timestamp: 1710000047000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmulti-accept-same-trade', userId: 'UmultiSameOpener' },
        message: { type: 'text', id: 'm-multi-same-trade', text: 'ชล200' },
        timestamp: 1710000048000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmulti-accept-same-trade', userId: 'UmultiSameAcceptOne' },
        message: { type: 'text', id: 'm-multi-same-accept-one', quotedMessageId: 'm-multi-same-trade', text: 'ต' },
        timestamp: 1710000049000
      },
      confirmPairEvent('Gmulti-accept-same-trade', 'UmultiSameOpener', 'm-multi-same-accept-one', 'm-multi-same-confirm-one', 1710000049500),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gmulti-accept-same-trade', userId: 'UmultiSameAcceptTwo' },
        message: { type: 'text', id: 'm-multi-same-accept-two', quotedMessageId: 'm-multi-same-trade', text: 'ต' },
        timestamp: 1710000050000
      },
      confirmPairEvent('Gmulti-accept-same-trade', 'UmultiSameOpener', 'm-multi-same-accept-two', 'm-multi-same-confirm-two', 1710000050500)
    ]);

    const wounds = await (await fetch(`${server.baseUrl}/api/wounds`)).json();
    assert.equal(wounds.length, 2);
    assert.deepEqual(
      wounds.map((wound) => [wound.openMessageId, wound.accepterUserId, wound.amount, wound.requiredCredit]).sort(),
      [
        ['m-multi-same-trade', 'UmultiSameAcceptOne', '200', 200],
        ['m-multi-same-trade', 'UmultiSameAcceptTwo', '200', 200]
      ]
    );

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.filter((log) => log.woundCreated).length, 2);
    assert.equal(logs.some((log) => log.woundRejectedReason === 'already_paired'), false);
  } finally {
    await server.stop();
  }
});
