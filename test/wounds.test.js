const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const test = require('node:test');

const SERVER_READY_TIMEOUT_MS = 15000;
let nextPort = 3300 + Math.floor(Math.random() * 500);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function startServer() {
  const port = nextPort++;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LINE_CHANNEL_SECRET: '',
      LINE_OFFICIAL_ACCOUNT_URL: 'https://line.me/R/ti/p/@lamp-cover',
      ADMIN_KEYWORD: 'I AM ADMIN'
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

function creditEvent(userId, amount, id, timestamp) {
  return {
    type: 'message',
    source: { type: 'user', userId },
    message: { type: 'text', id, text: `C+${amount}` },
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
      creditEvent(openerUserId, 1000, 'm-credit-named-opener', 1710000090000),
      creditEvent(accepterUserId, 1000, 'm-credit-named-accepter', 1710000090001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-named-round-open', text: 'เปิด ศราช 350-380' },
        timestamp: 1710000091000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gnames', userId: openerUserId, displayName: 'AUI' },
        message: { type: 'text', id: 'm-named-trade', text: 'ชล600' },
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
    assert.match(texts, /ทีม/);
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
      creditEvent('UwinCard', 500, 'm-credit-result-win', 1710000113000),
      creditEvent('UloseCard', 500, 'm-credit-result-lose', 1710000113001),
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'Uadmin' },
        message: { type: 'text', id: 'm-result-card-open', text: 'เปิด AIO 600-800' },
        timestamp: 1710000114000
      },
      {
        type: 'message',
        source: { type: 'group', groupId: 'Gresult-cards', userId: 'UwinCard', displayName: 'AIO' },
        message: { type: 'text', id: 'm-result-card-trade', text: 'ชล100' },
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
    assert.match(winTexts, /\+95\.00/);
    assert.match(winTexts, /\+100\.00 -5% = \+95\.00/);
    assert.match(loseTexts, /ผลรอบ "AIO"/);
    assert.match(loseTexts, /ผลออก 900/);
    assert.match(loseTexts, /#\d+ ❌ แพ้ vs AIO/);
    assert.match(loseTexts, /คุณทาย: ทายแพ้ \| ราคา: 600-800/);
    assert.match(loseTexts, /-100\.00/);
    assert.match(loseTexts, /แพ้/);
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

test('settles a ไล่ prediction as winner with 0.95 payout', async () => {
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
    assert.equal(wounds[0].winnerPayoutAmount, 95);
    assert.equal(wounds[0].systemFeeAmount, 5);

    const credits = await (await fetch(`${server.baseUrl}/api/credits`)).json();
    const byUserId = new Map(credits.map((credit) => [credit.userId, credit]));
    assert.equal(byUserId.get('Urunner').balance, 295);
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
    assert.equal(byUserId.get('Ufader').balance, 295);
    assert.equal(byUserId.get('Urunner').balance, 100);
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
    assert.equal(logs.some((log) => log.queueListSaved), true);
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
        message: { type: 'text', id: 'm-manual-finish-command', text: 'ปิดคิวสุดท้าย' },
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

test('replies with the LINE OA link when a group member asks for หลังบ้าน', async () => {
  const server = await startServer();

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
    assert.deepEqual(linkLog.behindHouseReplyTexts, ['https://line.me/R/ti/p/@lamp-cover']);
  } finally {
    await server.stop();
  }
});

test('adds private chat credit from C+ commands', async () => {
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
    const credit = credits.find((row) => row.userId === 'Ucredit');

    assert.equal(credit.balance, 359);
    assert.equal(credit.totalAdded, 359);
    assert.equal(credit.transactions.length, 2);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    assert.equal(logs.filter((log) => log.creditAction === 'credit_added').length, 2);
  } finally {
    await server.stop();
  }
});

test('builds balance, active wound, and withdraw cards from keywords', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcredit2');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'Ubuyer' },
        replyToken: 'reply-credit-add',
        message: { type: 'text', id: 'm-credit-add-buyer', text: 'C+120' },
        timestamp: 1710000000000
      },
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
        timestamp: 1710000006000
      }
    ]);

    const logs = await (await fetch(`${server.baseUrl}/api/logs`)).json();
    const balanceLog = logs.find((log) => log.creditAction === 'balance_card');
    const activeLog = logs.find((log) => log.creditAction === 'active_wounds_card');
    const withdrawLog = logs.find((log) => log.creditAction === 'withdraw_card');

    assert.equal(balanceLog.creditBalance, 120);
    assert.equal(balanceLog.activeWoundAmount, 100);
    assert.equal(activeLog.activeWoundCount, 1);
    assert.equal(activeLog.activeWoundAmount, 100);
    assert.equal(withdrawLog.withdrawableBalance, 20);
  } finally {
    await server.stop();
  }
});

test('credit flex cards do not attach quick reply buttons or point labels', () => {
  const source = fs.readFileSync('server.js', 'utf8');

  assert.equal(source.includes('quickReply'), false);
  assert.equal(source.includes('แต้ม'), false);
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
      {
        type: 'message',
        source: { type: 'user', userId: 'UopenerCredit' },
        message: { type: 'text', id: 'm-credit-opener-170', text: 'C+170' },
        timestamp: 1710000020000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UpoorAccepter' },
        message: { type: 'text', id: 'm-credit-poor-100', text: 'C+100' },
        timestamp: 1710000020001
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UrichAccepter' },
        message: { type: 'text', id: 'm-credit-rich-200', text: 'C+200' },
        timestamp: 1710000020002
      },
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

test('reserves active wound credit across multiple pairs and blocks duplicate accepts', async () => {
  const server = await startServer();

  try {
    await clearJson(server.baseUrl, '/api/logs');
    await clearJson(server.baseUrl, '/api/admins');
    await clearJson(server.baseUrl, '/api/wounds');
    await clearJson(server.baseUrl, '/api/rounds');
    await clearJson(server.baseUrl, '/api/credits');

    await registerAndBindAdmin(server.baseUrl, 'Gcredit-reserve');

    await postWebhook(server.baseUrl, [
      {
        type: 'message',
        source: { type: 'user', userId: 'UmultiOpener' },
        message: { type: 'text', id: 'm-credit-multi-opener', text: 'C+370' },
        timestamp: 1710000030000
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UacceptOne' },
        message: { type: 'text', id: 'm-credit-accept-one', text: 'C+200' },
        timestamp: 1710000030001
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UacceptTwo' },
        message: { type: 'text', id: 'm-credit-accept-two', text: 'C+250' },
        timestamp: 1710000030002
      },
      {
        type: 'message',
        source: { type: 'user', userId: 'UacceptThree' },
        message: { type: 'text', id: 'm-credit-accept-three', text: 'C+250' },
        timestamp: 1710000030003
      },
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
    assert.equal(logs.some((log) => log.woundRejectedReason === 'already_paired'), true);
    const insufficientLog = logs.find((log) => log.woundRejectedReason === 'insufficient_credit');
    assert.deepEqual(insufficientLog.insufficientCreditUsers, ['UmultiOpener']);
    assert.equal(insufficientLog.requiredCredit, 1);
  } finally {
    await server.stop();
  }
});
