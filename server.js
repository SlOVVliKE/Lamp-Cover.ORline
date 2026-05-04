require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ADMIN_KEYWORD = process.env.ADMIN_KEYWORD || 'I AM ADMIN';
const LOG_FILE = path.join(__dirname, 'logs.json');
const ADMIN_FILE = path.join(__dirname, 'admins.json');
const MESSAGE_FILE = path.join(__dirname, 'messages.json');
const WOUND_FILE = path.join(__dirname, 'wounds.json');
const ROUND_FILE = path.join(__dirname, 'rounds.json');
const QUEUE_LIST_FILE = path.join(__dirname, 'queueLists.json');
const CREDIT_FILE = path.join(__dirname, 'credits.json');
const MAX_LOGS = 1000;
const MAX_ADMINS = 1000;
const MAX_MESSAGES = 3000;
const MAX_WOUNDS = 1000;
const MAX_ROUNDS = 1000;
const MAX_QUEUE_LISTS = 200;
const MAX_CREDITS = 5000;
const MAX_CREDIT_TRANSACTIONS = 200;
const RESULT_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;

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

function readRounds() {
  return sortRounds(readJsonArray(ROUND_FILE, 'rounds.json'));
}

function writeRounds(rounds) {
  writeJsonArray(ROUND_FILE, sortRounds(rounds), MAX_ROUNDS);
}

function readQueueLists() {
  return sortQueueLists(readJsonArray(QUEUE_LIST_FILE, 'queueLists.json'));
}

function writeQueueLists(queueLists) {
  writeJsonArray(QUEUE_LIST_FILE, sortQueueLists(queueLists), MAX_QUEUE_LISTS);
}

function readCredits() {
  return sortCredits(readJsonArray(CREDIT_FILE, 'credits.json'));
}

function writeCredits(credits) {
  writeJsonArray(CREDIT_FILE, sortCredits(credits), MAX_CREDITS);
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

function sortRounds(rounds) {
  return [...rounds].sort((roundA, roundB) => (roundB.openedTimestamp || 0) - (roundA.openedTimestamp || 0));
}

function sortQueueLists(queueLists) {
  return [...queueLists].sort((listA, listB) => (listB.timestamp || 0) - (listA.timestamp || 0));
}

function normalizeCreditRow(row) {
  const transactions = Array.isArray(row.transactions) ? row.transactions : [];

  return {
    userId: row.userId || '',
    balance: Number(row.balance) || 0,
    totalAdded: Number(row.totalAdded) || 0,
    transactions: transactions.slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: row.updatedTimestamp || row.timestamp || 0,
    updatedTime: row.updatedTime || row.time || ''
  };
}

function sortCredits(credits) {
  return [...credits]
    .map(normalizeCreditRow)
    .filter((credit) => credit.userId)
    .sort((creditA, creditB) => (creditB.updatedTimestamp || 0) - (creditA.updatedTimestamp || 0));
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

function parseBindGroupCommand(message) {
  const text = normalizeMessageText(message);
  const match = text.match(/^(?:ผูกกลุ่ม|à¸œà¸¹à¸à¸à¸¥à¸¸à¹ˆà¸¡)\s*:\s*(.+)$/i);
  if (!match) return null;

  const groupName = match[1].trim();
  if (!groupName) return null;

  return {
    groupName,
    groupKey: normalizeGroupName(groupName)
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

function normalizeQueueLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function looksLikeDateLine(line) {
  return /\d/.test(line) && /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|\d{4})/.test(line);
}

function parseQueueListMessage(message) {
  const rawLines = String(message || '').replace(/\r\n/g, '\n').split('\n');
  const lines = rawLines.map((line) => normalizeQueueLine(line));
  const firstContentIndex = lines.findIndex((line) => line.length > 0);

  if (firstContentIndex < 0 || !lines[firstContentIndex].startsWith('คิวจุดรายการ')) {
    return null;
  }

  const firstBlankAfterHeader = lines.findIndex((line, index) => index > firstContentIndex && line.length === 0);
  const itemStartIndex = firstBlankAfterHeader >= 0 ? firstBlankAfterHeader + 1 : firstContentIndex + 1;
  const headerLines = lines
    .slice(firstContentIndex, firstBlankAfterHeader >= 0 ? firstBlankAfterHeader : itemStartIndex)
    .filter(Boolean);
  const headerParts = headerLines.map((line, index) =>
    index === 0 ? line.replace(/^คิวจุดรายการ\s*/, '').trim() : line
  );
  const dateLineIndex = headerParts.findIndex(looksLikeDateLine);
  const dateText = dateLineIndex >= 0 ? headerParts[dateLineIndex] : '';
  const title = headerParts.filter((_, index) => index !== dateLineIndex).join(' ').trim();
  const itemLines = [];
  let note = '';

  for (const line of lines.slice(itemStartIndex)) {
    if (!line) continue;
    if (/^หมายเหตุ/.test(line)) {
      note = line;
      break;
    }

    itemLines.push(line);
  }

  if (!title || itemLines.length === 0) {
    return null;
  }

  return {
    title,
    dateText,
    items: itemLines.map((name, index) => ({
      order: index + 1,
      name
    })),
    note,
    rawText: String(message || '')
  };
}

function formatClockTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatElapsedSeconds(fromTimestamp, toTimestamp) {
  if (!fromTimestamp || !toTimestamp) return '-';
  const seconds = Math.max(0, (toTimestamp - fromTimestamp) / 1000);
  return `${seconds.toFixed(2)} seconds`;
}

function parsePriceRange(message) {
  const match = String(message || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;

  const low = Number(match[1]);
  const high = Number(match[2]);
  const min = Math.min(low, high);
  const max = Math.max(low, high);

  return {
    raw: `${match[1]}-${match[2]}`,
    low: min,
    high: max
  };
}

function parseOpenCommand(message) {
  const match = normalizeMessageText(message).match(/^เปิด\s+(.+)$/i);
  if (!match) return null;

  let queueName = match[1].trim();
  const price = parsePriceRange(queueName);
  const noBuilderPrice = /ช่างไม่ตี|ไม่ตี/.test(queueName);

  if (price) {
    queueName = queueName.replace(/\d+\s*-\s*\d+/, '').trim();
  }

  if (noBuilderPrice) {
    queueName = queueName.replace(/เบื้องต้น|ช่างไม่ตี|ไม่ตี/g, '').trim();
  }

  if (!queueName) return null;

  return {
    queueName,
    price,
    noBuilderPrice
  };
}

function parseCloseCommand(message) {
  return normalizeMessageText(message) === 'ปิด';
}

function parseBuilderPriceCommand(message) {
  const match = normalizeMessageText(message).match(/^ราคาช่าง\s*(.+)$/i);
  if (!match) return null;

  return parsePriceRange(match[1]);
}

function getLatestRoundForGroup(groupId) {
  return readRounds().find((round) => round.groupId === groupId) || null;
}

function getOpenRoundForGroup(groupId) {
  return readRounds().find((round) => round.groupId === groupId && round.status === 'open') || null;
}

function getLatestQueueListForGroup(groupId) {
  return readQueueLists().find((queueList) => queueList.groupId === groupId) || null;
}

function upsertRound(roundEntry) {
  const rounds = readRounds().filter((round) => round.id !== roundEntry.id);
  writeRounds([roundEntry, ...rounds]);
  return roundEntry;
}

function getPriceFields(price) {
  if (!price) {
    return {
      priceRaw: '',
      priceLow: null,
      priceHigh: null
    };
  }

  return {
    priceRaw: price.raw,
    priceLow: price.low,
    priceHigh: price.high
  };
}

function getRoundPrice(round) {
  if (!round?.priceRaw || round.priceLow === null || round.priceHigh === null) {
    return null;
  }

  return {
    raw: round.priceRaw,
    low: Number(round.priceLow),
    high: Number(round.priceHigh)
  };
}

function buildOpenReply(round) {
  if (round.noBuilderPrice) {
    return `${round.queueName}\n\nเบื้องต้นช่างไม่ตี ⛔️\n\n🚀🚀🚀🚀🚀`;
  }

  if (round.priceRaw) {
    return `${round.queueName}\n\nช่าง ${round.priceRaw}⛔️\n\n🚀🚀🚀🚀🚀`;
  }

  return `${round.queueName}\n\nช่าง ⛔️\n\n🚀🚀🚀🚀🚀`;
}

function buildCloseReply(round) {
  return `❌❌❌❌ ปิด ❌❌❌❌\n\n3 2 1 ไป๊!! 🚀🚀🚀\n\n${round.queueName}\n\n⛔หลังปิดไม่ติดทุกกรณี⛔`;
}

function getResultIcon(round, result) {
  const resultNumber = Number(result);
  const price = getRoundPrice(round);

  if (!price || Number.isNaN(resultNumber)) {
    return '➖';
  }

  if (resultNumber > price.high) return '✅';
  if (resultNumber < price.low) return '❌';
  return '➖';
}

function buildRoundResultLine(round) {
  if (!round.result) {
    return round.queueName;
  }

  if (round.priceRaw) {
    return `${round.queueName} ${round.priceRaw} ${round.result}${round.resultIcon || getResultIcon(round, round.result)}`;
  }

  return `${round.queueName} ช่างไม่ต่อย ${round.result}➖`;
}

function buildQueueSummary(groupId) {
  const rounds = readRounds()
    .filter((round) => round.groupId === groupId)
    .sort((roundA, roundB) => (roundA.openedTimestamp || 0) - (roundB.openedTimestamp || 0));
  const queueList = getLatestQueueListForGroup(groupId);

  if (!queueList) {
    const lines = rounds.map(buildRoundResultLine);
    return `คิวจุด✅\n\n${lines.join('\n')}`;
  }

  const roundsByName = new Map(
    rounds.map((round) => [normalizeGroupName(round.queueName), round])
  );
  const lines = queueList.items.map((item) => {
    const round = roundsByName.get(normalizeGroupName(item.name));
    return round ? buildRoundResultLine(round) : item.name;
  });
  const note = queueList.note ? `\n\n${queueList.note}` : '';

  return `คิวจุด✅\n\n${lines.join('\n')}${note}`;
}

function toLineMessage(message) {
  if (typeof message === 'string') {
    return {
      type: 'text',
      text: message
    };
  }

  return message;
}

function parseCreditAddCommand(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const amounts = [];
  for (const part of parts) {
    const match = part.match(/^c\s*\+\s*(\d+(?:\.\d{1,2})?)$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    amounts.push(amount);
  }

  return {
    amounts,
    total: roundPoints(amounts.reduce((sum, amount) => sum + amount, 0))
  };
}

function parseCreditKeyword(message) {
  const text = normalizeMessageText(message);
  if (['เช็คยอดเงิน', 'เช็คยอด'].includes(text)) return 'balance';
  if (['แผลที่กำลังติด', 'การจับคู่', 'จับคู่'].includes(text)) return 'active_wounds';
  if (['ถอนยอดเงิน', 'ถอน'].includes(text)) return 'withdraw';
  return null;
}

function roundPoints(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatPoints(value) {
  return roundPoints(value).toFixed(2);
}

function findCreditByUserId(userId) {
  return readCredits().find((credit) => credit.userId === userId) || {
    userId,
    balance: 0,
    totalAdded: 0,
    transactions: [],
    updatedTimestamp: 0,
    updatedTime: ''
  };
}

function addCreditForUser(event, totalAmount, rawText) {
  const source = event.source || {};
  const nowTimestamp = event.timestamp || Date.now();
  const credits = readCredits();
  const existing = credits.find((credit) => credit.userId === source.userId) || {
    userId: source.userId,
    balance: 0,
    totalAdded: 0,
    transactions: []
  };
  const nextBalance = roundPoints(existing.balance + totalAmount);
  const transaction = {
    id: `${event.message?.id || nowTimestamp}:credit`,
    type: 'credit_added',
    amount: totalAmount,
    rawText,
    messageId: event.message?.id || '',
    balanceAfter: nextBalance,
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp)
  };
  const updatedCredit = {
    ...existing,
    balance: nextBalance,
    totalAdded: roundPoints(existing.totalAdded + totalAmount),
    transactions: [transaction, ...(existing.transactions || [])].slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  };
  const remainingCredits = credits.filter((credit) => credit.userId !== source.userId);

  writeCredits([updatedCredit, ...remainingCredits]);
  return {
    credit: updatedCredit,
    transaction
  };
}

function getUserActiveWounds(userId) {
  if (!userId) return [];

  return readWounds().filter(
    (wound) =>
      wound.status === 'active' &&
      (wound.openerUserId === userId || wound.accepterUserId === userId)
  );
}

function getWoundAmount(wound) {
  const amount = Number(String(wound?.amount || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function getCreditSnapshot(userId) {
  const credit = findCreditByUserId(userId);
  const activeWounds = getUserActiveWounds(userId);
  const activeWoundAmount = roundPoints(activeWounds.reduce((sum, wound) => sum + getWoundAmount(wound), 0));
  const withdrawableBalance = Math.max(0, roundPoints(credit.balance - activeWoundAmount));

  return {
    credit,
    activeWounds,
    activeWoundAmount,
    withdrawableBalance
  };
}

function flexText(text, options = {}) {
  return {
    type: 'text',
    text: String(text),
    wrap: true,
    ...options
  };
}

function flexRow(label, value, valueColor = '#111827') {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      flexText(label, { size: 'sm', color: '#9CA3AF', flex: 4 }),
      flexText(value, { size: 'sm', color: valueColor, weight: 'bold', align: 'end', flex: 6 })
    ]
  };
}

function buildCreditBubble({ title, titleColor, bodyColor, amount, subtitle, rows, footer }) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: titleColor,
      paddingAll: '16px',
      contents: [
        flexText(title, { color: '#FFFFFF', weight: 'bold', size: 'lg' })
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '18px',
      contents: [
        flexText(subtitle, { color: '#9CA3AF', align: 'center', size: 'sm' }),
        flexText(amount, { color: bodyColor, align: 'center', weight: 'bold', size: '4xl' }),
        {
          type: 'separator',
          margin: 'lg'
        },
        ...rows,
        ...(footer ? [flexText(footer, { color: '#C7C7C7', align: 'center', size: 'xs', margin: 'md' })] : [])
      ]
    }
  };
}

function withCreditQuickReplies(message) {
  return {
    ...message,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: 'เช็คยอดเงิน', text: 'เช็คยอดเงิน' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'แผลที่กำลังติด', text: 'แผลที่กำลังติด' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'ถอนยอดเงิน', text: 'ถอนยอดเงิน' }
        }
      ]
    }
  };
}

function buildCreditAddedFlex(amount, snapshot) {
  return withCreditQuickReplies({
    type: 'flex',
    altText: `เพิ่มเครดิตสำเร็จ +${formatPoints(amount)} แต้ม`,
    contents: buildCreditBubble({
      title: '✓ สลิปถูกต้อง',
      titleColor: '#22C55E',
      bodyColor: '#111827',
      subtitle: 'ตรวจสอบโดยระบบ',
      amount: formatPoints(amount),
      rows: [
        flexRow('แต้มที่ได้รับ', `+${formatPoints(amount)} แต้ม`, '#22C55E'),
        flexRow('แต้มคงเหลือ', `${formatPoints(snapshot.credit.balance)} แต้ม`),
        flexRow('กำลังใช้', `${formatPoints(snapshot.activeWoundAmount)} แต้ม`, '#F59E0B')
      ],
      footer: 'ส่งเมนูเพื่อดูยอดหรือแผลที่กำลังติด'
    })
  });
}

function buildBalanceFlex(snapshot) {
  return withCreditQuickReplies({
    type: 'flex',
    altText: `ยอดแต้มคงเหลือ ${formatPoints(snapshot.credit.balance)} แต้ม`,
    contents: buildCreditBubble({
      title: '💰 ยอดแต้มของคุณ',
      titleColor: '#3B82F6',
      bodyColor: '#3B82F6',
      subtitle: 'แต้มคงเหลือ',
      amount: formatPoints(snapshot.credit.balance),
      rows: [
        flexRow('กำลังใช้', `${formatPoints(snapshot.activeWoundAmount)} แต้ม`, '#F59E0B'),
        flexRow('ถอนได้', `${formatPoints(snapshot.withdrawableBalance)} แต้ม`, '#111827'),
        flexRow('จำนวนแผล', `${snapshot.activeWounds.length} รายการ`, '#F59E0B')
      ],
      footer: 'ตรวจสอบโดยระบบ'
    })
  });
}

function buildActiveWoundsFlex(snapshot) {
  const woundRows = snapshot.activeWounds.slice(0, 5).map((wound) => {
    const opponent = wound.openerUserId === snapshot.credit.userId ? wound.accepterUserId : wound.openerUserId;
    const label = wound.roundName || wound.groupId || 'รายการ';
    return flexRow(`#${String(wound.id || '').slice(-6)} ${label}`, `vs ${opponent || '-'} ${formatPoints(getWoundAmount(wound))}`, '#F59E0B');
  });

  return withCreditQuickReplies({
    type: 'flex',
    altText: `แผลที่กำลังติด ${snapshot.activeWounds.length} รายการ`,
    contents: buildCreditBubble({
      title: '📋 จับคู่อยู่',
      titleColor: '#F59E0B',
      bodyColor: '#F59E0B',
      subtitle: 'กำลังใช้อยู่',
      amount: `${formatPoints(snapshot.activeWoundAmount)} แต้ม`,
      rows: woundRows.length > 0
        ? [
            flexRow('รวม', `${snapshot.activeWounds.length} รายการ`, '#F59E0B'),
            ...woundRows
          ]
        : [
            flexRow('รวม', '0 รายการ', '#F59E0B'),
            flexText('ไม่มีรายการที่ค้างอยู่', { color: '#9CA3AF', align: 'center' })
          ],
      footer: ''
    })
  });
}

function buildWithdrawFlex(snapshot) {
  return withCreditQuickReplies({
    type: 'flex',
    altText: `ถอนยอดเงินได้ ${formatPoints(snapshot.withdrawableBalance)} แต้ม`,
    contents: buildCreditBubble({
      title: '🏧 ถอนยอดเงิน',
      titleColor: '#EF4444',
      bodyColor: '#EF4444',
      subtitle: 'ยอดที่ถอนได้',
      amount: `${formatPoints(snapshot.withdrawableBalance)} แต้ม`,
      rows: [
        flexRow('แต้มคงเหลือ', `${formatPoints(snapshot.credit.balance)} แต้ม`),
        flexRow('กำลังใช้', `${formatPoints(snapshot.activeWoundAmount)} แต้ม`, '#F59E0B'),
        flexRow('แผลที่ค้าง', `${snapshot.activeWounds.length} รายการ`, '#EF4444')
      ],
      footer: 'ยอดถอนได้ = ยอดคงเหลือ - แต้มที่กำลังใช้อยู่'
    })
  });
}

function handleCreditEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text' || !event.source?.userId) {
    return null;
  }

  const source = event.source || {};
  const messageText = getMessageText(event);

  if (source.type !== 'user') {
    return null;
  }

  const creditCommand = parseCreditAddCommand(messageText);
  if (creditCommand) {
    const result = addCreditForUser(event, creditCommand.total, messageText);
    const snapshot = getCreditSnapshot(source.userId);

    return {
      type: 'credit_added',
      amount: creditCommand.total,
      creditBalance: result.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      replyMessages: [buildCreditAddedFlex(creditCommand.total, snapshot)]
    };
  }

  const keyword = parseCreditKeyword(messageText);
  if (!keyword) return null;

  const snapshot = getCreditSnapshot(source.userId);
  if (keyword === 'balance') {
    return {
      type: 'balance_card',
      creditBalance: snapshot.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      replyMessages: [buildBalanceFlex(snapshot)]
    };
  }

  if (keyword === 'active_wounds') {
    return {
      type: 'active_wounds_card',
      creditBalance: snapshot.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      replyMessages: [buildActiveWoundsFlex(snapshot)]
    };
  }

  return {
    type: 'withdraw_card',
    creditBalance: snapshot.credit.balance,
    activeWoundAmount: snapshot.activeWoundAmount,
    withdrawableBalance: snapshot.withdrawableBalance,
    activeWoundCount: snapshot.activeWounds.length,
    replyMessages: [buildWithdrawFlex(snapshot)]
  };
}

async function replyToLine(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !replyToken || messages.length === 0) {
    return null;
  }

  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: messages.slice(0, 5).map(toLineMessage)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`LINE reply failed: ${response.status} ${errorText}`);
  }

  return response;
}

async function pushToLine(to, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !to || messages.length === 0) {
    return null;
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to,
      messages: messages.slice(0, 5).map(toLineMessage)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`LINE push failed: ${response.status} ${errorText}`);
  }

  return response;
}

async function getLineGroupMemberProfile(groupId, userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !groupId || !userId) {
    return null;
  }

  const response = await fetch(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
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

function bindGroupFromEvent(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const bindCommand = parseBindGroupCommand(getMessageText(event));
  if (!bindCommand || !source.groupId || !source.userId) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  const admins = readAdmins();
  const targetIndexes = admins
    .map((admin, index) => ({ admin, index }))
    .filter(({ admin }) => admin.userId === source.userId && admin.groupKey === bindCommand.groupKey)
    .map(({ index }) => index);

  if (targetIndexes.length === 0) {
    return {
      bound: false,
      groupName: bindCommand.groupName,
      groupKey: bindCommand.groupKey,
      groupId: source.groupId
    };
  }

  for (const index of targetIndexes) {
    admins[index] = {
      ...admins[index],
      groupName: bindCommand.groupName,
      groupKey: bindCommand.groupKey,
      groupId: source.groupId,
      boundAt: nowTimestamp,
      boundTime: formatDate(nowTimestamp)
    };
  }

  writeAdmins(admins);
  return {
    bound: true,
    groupName: bindCommand.groupName,
    groupKey: bindCommand.groupKey,
    groupId: source.groupId,
    userId: source.userId,
    adminCount: targetIndexes.length
  };
}

function isGroupTextMessage(event) {
  return event.type === 'message' && event.message?.type === 'text' && event.source?.type === 'group';
}

function trackGroupMessage(event) {
  if (!isGroupTextMessage(event) || !event.message.id) {
    return null;
  }

  const source = event.source || {};
  const openRound = getOpenRoundForGroup(source.groupId);
  const messageText = getMessageText(event);
  const messageEntry = {
    id: event.message.id,
    groupId: source.groupId || '',
    roundId: openRound?.id || '',
    roundName: openRound?.queueName || '',
    userId: source.userId || '',
    displayName: '',
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

function updateTrackedMessage(messageId, patch) {
  if (!messageId) return null;

  let updatedMessage = null;
  const messages = readMessages().map((message) => {
    if (message.id !== messageId) return message;

    updatedMessage = {
      ...message,
      ...patch
    };

    return updatedMessage;
  });

  if (updatedMessage) {
    writeMessages(messages);
  }

  return updatedMessage;
}

function buildUnsendNotification(event, trackedMessage, displayName) {
  const cancelTimestamp = event.timestamp || Date.now();
  const senderName = displayName || trackedMessage?.displayName || trackedMessage?.userId || event.source?.userId || '-';
  const cancelledMessage = trackedMessage?.text || '(ไม่พบข้อความเดิม)';
  const elapsed = formatElapsedSeconds(trackedMessage?.timestamp, cancelTimestamp);
  const cancelledAt = formatClockTime(cancelTimestamp);

  return `❌ พบการยกเลิกข้อความ ❌\n\n• ผู้ยกเลิก: ${senderName}\n• ยกเลิกเมื่อ: ${elapsed} ที่แล้ว\n• ข้อความ: ${cancelledMessage}\n• เวลา: ${cancelledAt} ที่ยกเลิก\n\n❌❌❌❌❌❌❌❌`;
}

async function handleUnsendEvent(event) {
  if (event.type !== 'unsend' || event.source?.type !== 'group') {
    return null;
  }

  const source = event.source || {};
  const messageId = event.unsend?.messageId || '';
  const trackedMessage = findTrackedMessage(messageId);
  let displayName = trackedMessage?.displayName || '';

  if (!displayName && source.groupId && source.userId) {
    const profile = await getLineGroupMemberProfile(source.groupId, source.userId);
    displayName = profile?.displayName || '';
  }

  const updatedMessage = trackedMessage
    ? updateTrackedMessage(messageId, {
        displayName,
        unsent: true,
        unsentTimestamp: event.timestamp || Date.now(),
        unsentTime: formatDate(event.timestamp || Date.now())
      })
    : null;
  const notification = buildUnsendNotification(event, updatedMessage || trackedMessage, displayName);

  await pushToLine(source.groupId, [notification]);

  return {
    type: 'unsend_detected',
    groupId: source.groupId || '',
    userId: source.userId || '',
    displayName: displayName || source.userId || '',
    messageId,
    cancelledMessage: trackedMessage?.text || '',
    notification
  };
}

function createWoundFromReply(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const openRound = getOpenRoundForGroup(source.groupId);
  if (!openRound) return null;

  const acceptKeyword = parseAcceptMessage(getMessageText(event));
  const quotedMessage = findTrackedMessage(event.message.quotedMessageId);

  if (!acceptKeyword || !quotedMessage?.trade) return null;
  if (quotedMessage.groupId !== source.groupId) return null;
  if (quotedMessage.roundId !== openRound.id) return null;
  if (!quotedMessage.userId || quotedMessage.userId === source.userId) return null;

  const nowTimestamp = event.timestamp || Date.now();
  const wounds = readWounds();
  const existingWound = wounds.find(
    (wound) =>
      wound.status === 'active' &&
      wound.groupId === source.groupId &&
      wound.roundId === openRound.id &&
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
    roundId: openRound.id,
    roundName: openRound.queueName,
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
  if (!userId || !groupId) return false;

  return readAdmins().some((admin) => {
    if (admin.userId !== userId) return false;
    return admin.groupId === groupId;
  });
}

function handleQueueListMessage(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  if (!isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const queueList = parseQueueListMessage(getMessageText(event));
  if (!queueList) return null;

  const nowTimestamp = event.timestamp || Date.now();
  const entry = {
    id: `${source.groupId}:${nowTimestamp}:${event.message.id || ''}`,
    groupId: source.groupId || '',
    title: queueList.title,
    dateText: queueList.dateText,
    items: queueList.items,
    note: queueList.note,
    rawText: queueList.rawText,
    createdByUserId: source.userId || '',
    messageId: event.message.id || '',
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp)
  };
  const queueLists = readQueueLists().filter((list) => list.groupId !== entry.groupId);

  writeQueueLists([entry, ...queueLists]);
  return entry;
}

function closeWoundsForRound(event, result, round) {
  const source = event.source || {};
  const nowTimestamp = event.timestamp || Date.now();
  let closedCount = 0;
  const wounds = readWounds().map((wound) => {
    if (wound.status !== 'active' || wound.groupId !== source.groupId || wound.roundId !== round.id) {
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

  return closedCount;
}

function handleQueueAdminCommand(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const messageText = getMessageText(event);
  if (!isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  const openCommand = parseOpenCommand(messageText);
  if (openCommand) {
    const priceFields = getPriceFields(openCommand.price);
    const round = {
      id: `${source.groupId}:${nowTimestamp}:${event.message.id || ''}`,
      groupId: source.groupId || '',
      queueName: openCommand.queueName,
      status: 'open',
      ...priceFields,
      noBuilderPrice: openCommand.noBuilderPrice,
      openedByUserId: source.userId || '',
      openedMessageId: event.message.id || '',
      openedTimestamp: nowTimestamp,
      openedTime: formatDate(nowTimestamp),
      closedByUserId: '',
      closedMessageId: '',
      closedTimestamp: null,
      closedTime: '',
      result: '',
      resultIcon: '',
      resultTimestamp: null,
      resultTime: '',
      pendingResult: null
    };

    upsertRound(round);
    return {
      type: 'round_opened',
      round,
      replyTexts: [buildOpenReply(round)]
    };
  }

  if (parseCloseCommand(messageText)) {
    const round = getOpenRoundForGroup(source.groupId);
    if (!round) return null;

    const closedRound = {
      ...round,
      status: 'closed',
      closedByUserId: source.userId || '',
      closedMessageId: event.message.id || '',
      closedTimestamp: nowTimestamp,
      closedTime: formatDate(nowTimestamp),
      pendingResult: null
    };

    upsertRound(closedRound);
    return {
      type: 'round_closed',
      round: closedRound,
      replyTexts: [buildCloseReply(closedRound)]
    };
  }

  const builderPrice = parseBuilderPriceCommand(messageText);
  if (builderPrice) {
    const round = getLatestRoundForGroup(source.groupId);
    if (!round || round.status === 'resulted') return null;

    const updatedRound = {
      ...round,
      ...getPriceFields(builderPrice),
      noBuilderPrice: false,
      priceSetByUserId: source.userId || '',
      priceSetMessageId: event.message.id || '',
      priceSetTimestamp: nowTimestamp,
      priceSetTime: formatDate(nowTimestamp)
    };

    upsertRound(updatedRound);
    return {
      type: 'builder_price_set',
      round: updatedRound,
      replyTexts: [`บันทึกราคาช่าง ${builderPrice.raw} สำหรับ ${updatedRound.queueName}`]
    };
  }

  const result = parseResultCommand(messageText);
  if (!result) return null;

  const round = getLatestRoundForGroup(source.groupId);
  if (!round || round.status === 'open') return null;

  const pendingResult = round.pendingResult;
  const isConfirmation =
    pendingResult?.result === result &&
    pendingResult?.userId === source.userId &&
    nowTimestamp - pendingResult.timestamp <= RESULT_CONFIRMATION_WINDOW_MS;

  if (!isConfirmation) {
    const pendingRound = {
      ...round,
      pendingResult: {
        result,
        userId: source.userId || '',
        timestamp: nowTimestamp,
        expiresAt: nowTimestamp + RESULT_CONFIRMATION_WINDOW_MS
      }
    };

    upsertRound(pendingRound);
    return {
      type: 'result_confirmation_requested',
      round: pendingRound,
      result,
      replyTexts: [`⚠️ ยืนยันผล: ${result}  ส่ง แจ้งผล ${result} อีกครั้งเพื่อยืนยัน (หมดเวลาใน 5 นาที)`]
    };
  }

  const resultIcon = getResultIcon(round, result);
  const resultedRound = {
    ...round,
    status: 'resulted',
    result,
    resultIcon,
    resultByUserId: source.userId || '',
    resultMessageId: event.message.id || '',
    resultTimestamp: nowTimestamp,
    resultTime: formatDate(nowTimestamp),
    pendingResult: null
  };
  const closedCount = closeWoundsForRound(event, result, resultedRound);

  upsertRound(resultedRound);
  return {
    type: 'result_confirmed',
    round: resultedRound,
    result,
    closedCount,
    replyTexts: [`${resultedRound.queueName}\n\nผล ${result}///\n\n🚀🚀🚀🚀🚀`, buildQueueSummary(source.groupId)]
  };
}

ensureJsonFile(LOG_FILE);
ensureJsonFile(ADMIN_FILE);
ensureJsonFile(MESSAGE_FILE);
ensureJsonFile(WOUND_FILE);
ensureJsonFile(ROUND_FILE);
ensureJsonFile(QUEUE_LIST_FILE);
ensureJsonFile(CREDIT_FILE);

// LINE signature verification needs the exact raw request body.
app.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '2mb' }),
  verifyLineSignature,
  async (req, res) => {
    const replyJobs = [];

    try {
      const bodyText = req.body ? req.body.toString('utf8') : '{}';
      const payload = bodyText ? JSON.parse(bodyText) : {};
      const events = Array.isArray(payload.events) ? payload.events : [];

      if (events.length > 0) {
        const newLogs = [];

        for (const event of events) {
          const logEntry = createLogEntry(event);
          const adminEntry = upsertAdminFromEvent(event);
          const bindEntry = bindGroupFromEvent(event);
          const queueListEntry = handleQueueListMessage(event);
          const queueAction = handleQueueAdminCommand(event);
          const woundEntry = createWoundFromReply(event);
          const trackedMessage = trackGroupMessage(event);
          const unsendAction = await handleUnsendEvent(event);
          const creditAction = handleCreditEvent(event);

          if (adminEntry) {
            logEntry.adminRegistered = true;
            logEntry.adminGroupName = adminEntry.groupName;
            logEntry.adminPriority = adminEntry.priority;
          }

          if (bindEntry) {
            logEntry.groupBindRequested = true;
            logEntry.groupBindSuccess = bindEntry.bound;
            logEntry.boundGroupName = bindEntry.groupName;
            logEntry.boundGroupId = bindEntry.groupId;
          }

          if (queueListEntry) {
            logEntry.queueListSaved = true;
            logEntry.queueListTitle = queueListEntry.title;
            logEntry.queueListItemCount = queueListEntry.items.length;
          }

          if (queueAction) {
            logEntry.queueAction = queueAction.type;
            logEntry.queueName = queueAction.round?.queueName || '';
            logEntry.result = queueAction.result || '';

            if (typeof queueAction.closedCount === 'number') {
              logEntry.woundsClosed = queueAction.closedCount;
            }

            if (Array.isArray(queueAction.replyTexts) && queueAction.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, queueAction.replyTexts));
            }
          }

          if (woundEntry) {
            logEntry.woundCreated = true;
            logEntry.woundId = woundEntry.id;
          }

          if (trackedMessage?.trade) {
            logEntry.tradeKeyword = trackedMessage.trade.keyword;
            logEntry.tradeAmount = trackedMessage.trade.amount;
          }

          if (unsendAction) {
            logEntry.unsendDetected = true;
            logEntry.unsendMessageId = unsendAction.messageId;
            logEntry.cancelledMessage = unsendAction.cancelledMessage;
            logEntry.unsendDisplayName = unsendAction.displayName;
            logEntry.unsendNotification = unsendAction.notification;
          }

          if (creditAction) {
            logEntry.creditAction = creditAction.type;
            logEntry.creditAmount = creditAction.amount || 0;
            logEntry.creditBalance = creditAction.creditBalance;
            logEntry.activeWoundAmount = creditAction.activeWoundAmount;
            logEntry.activeWoundCount = creditAction.activeWoundCount || 0;
            logEntry.withdrawableBalance = creditAction.withdrawableBalance;

            if (Array.isArray(creditAction.replyMessages) && creditAction.replyMessages.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, creditAction.replyMessages));
            }
          }

          newLogs.push(logEntry);
        }
        const logs = readLogs();
        writeLogs([...newLogs, ...logs]);
      }

      if (replyJobs.length > 0) {
        await Promise.allSettled(replyJobs);
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
      <a href="/rounds">Rounds</a>
      <a href="/queue-lists">Queue Lists</a>
      <a href="/credits">Credits</a>
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
        <td>${escapeHtml(admin.groupId)}</td>
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
                  <th>Group ID</th>
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

app.get('/rounds', (req, res) => {
  const rounds = readRounds();
  const rows = rounds
    .map(
      (round) => `<tr>
        <td>${escapeHtml(round.status)}</td>
        <td>${escapeHtml(round.openedTime)}</td>
        <td>${escapeHtml(round.groupId)}</td>
        <td>${escapeHtml(round.queueName)}</td>
        <td>${escapeHtml(round.priceRaw || (round.noBuilderPrice ? 'ช่างไม่ตี' : ''))}</td>
        <td>${escapeHtml(round.closedTime)}</td>
        <td>${escapeHtml(round.result)}</td>
        <td>${escapeHtml(round.resultIcon)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Queue Rounds</title>
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
      min-width: 940px;
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
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Queue Rounds</h1>
      <div class="actions">
        <a class="button" href="/rounds">Refresh</a>
        <a class="button" href="/wounds">Wounds</a>
        <button class="danger" type="button" onclick="clearRounds()">Clear Rounds</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Group ID</th>
                  <th>Queue Name</th>
                  <th>Builder Price</th>
                  <th>Closed</th>
                  <th>Result</th>
                  <th>Icon</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No rounds yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearRounds() {
      if (!confirm('Clear all rounds?')) return;

      const response = await fetch('/api/rounds', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear rounds.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/queue-lists', (req, res) => {
  const queueLists = readQueueLists();
  const rows = queueLists
    .map((queueList) => {
      const items = queueList.items.map((item) => `${item.order}. ${item.name}`).join('<br>');

      return `<tr>
        <td>${escapeHtml(queueList.time)}</td>
        <td>${escapeHtml(queueList.groupId)}</td>
        <td>${escapeHtml(queueList.title)}</td>
        <td>${escapeHtml(queueList.dateText)}</td>
        <td>${items}</td>
        <td>${escapeHtml(queueList.note)}</td>
      </tr>`;
    })
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Queue Lists</title>
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
      min-width: 980px;
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
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Queue Lists</h1>
      <div class="actions">
        <a class="button" href="/queue-lists">Refresh</a>
        <a class="button" href="/rounds">Rounds</a>
        <button class="danger" type="button" onclick="clearQueueLists()">Clear Queue Lists</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Group ID</th>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No queue lists yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearQueueLists() {
      if (!confirm('Clear all queue lists?')) return;

      const response = await fetch('/api/queue-lists', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear queue lists.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/credits', (req, res) => {
  const credits = readCredits();
  const rows = credits
    .map((credit) => {
      const latestTransaction = credit.transactions[0] || {};

      return `<tr>
        <td>${escapeHtml(credit.updatedTime)}</td>
        <td>${escapeHtml(credit.userId)}</td>
        <td>${escapeHtml(formatPoints(credit.balance))}</td>
        <td>${escapeHtml(formatPoints(credit.totalAdded))}</td>
        <td>${escapeHtml(credit.transactions.length)}</td>
        <td>${escapeHtml(latestTransaction.rawText || '')}</td>
      </tr>`;
    })
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Credits</title>
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
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Credits</h1>
      <div class="actions">
        <a class="button" href="/credits">Refresh</a>
        <a class="button" href="/logs">Logs</a>
        <button class="danger" type="button" onclick="clearCredits()">Clear Credits</button>
      </div>
    </div>
    <p class="hint">Private commands: <code>C+100</code>, <code>C+200, C+59</code>, <code>เช็คยอดเงิน</code>, <code>แผลที่กำลังติด</code>, <code>ถอนยอดเงิน</code></p>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Updated</th>
                  <th>User ID</th>
                  <th>Balance</th>
                  <th>Total Added</th>
                  <th>Transactions</th>
                  <th>Latest Command</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No credits yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearCredits() {
      if (!confirm('Clear all credits?')) return;

      const response = await fetch('/api/credits', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear credits.');
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

app.get('/api/rounds', (req, res) => {
  res.json(readRounds());
});

app.delete('/api/rounds', (req, res) => {
  writeRounds([]);
  writeMessages([]);
  writeWounds([]);
  res.json({ success: true });
});

app.get('/api/queue-lists', (req, res) => {
  res.json(readQueueLists());
});

app.delete('/api/queue-lists', (req, res) => {
  writeQueueLists([]);
  res.json({ success: true });
});

app.get('/api/credits', (req, res) => {
  res.json(readCredits());
});

app.delete('/api/credits', (req, res) => {
  writeCredits([]);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`LINE Webhook Logger is running on port ${PORT}`);
});
