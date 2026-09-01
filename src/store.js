// Simple JSON-file-backed store. No database needed — fine for a small team's volume.
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'queue.json');

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [], nextId: 1 }, null, 2));
  }
}

function readData() {
  ensureFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addItem({ assigneeId, channelId, messageTs, note, addedBy }) {
  const data = readData();
  const item = {
    id: data.nextId++,
    assigneeId,
    channelId,
    messageTs,
    note: note || '',
    addedBy,
    status: 'open',
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
  };
  data.items.push(item);
  writeData(data);
  return item;
}

function closeItem(itemId, closedBy) {
  const data = readData();
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return null;
  item.status = 'closed';
  item.closedAt = new Date().toISOString();
  item.closedBy = closedBy;
  writeData(data);
  return item;
}

function getOpenQueueForUser(userId) {
  const data = readData();
  return data.items.filter((i) => i.assigneeId === userId && i.status === 'open');
}

function getItem(itemId) {
  const data = readData();
  return data.items.find((i) => i.id === itemId);
}

module.exports = { addItem, closeItem, getOpenQueueForUser, getItem };
