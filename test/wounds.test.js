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
