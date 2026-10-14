const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// Admin password can be set via Render env var, else default
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json());
mongoose.set('strictQuery', false);

function hashPassword(p) {
    return crypto.createHash('sha256').update(p + 'casino_salt_2026').digest('hex');
}

// ---------- SCHEMAS ----------
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, index: true },
    passwordHash: String,
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const TxSchema = new mongoose.Schema({
    username: String, type: String, amount: Number,
    date: { type: Date, default: Date.now }, isPositive: Boolean
});
const DepSchema = new mongoose.Schema({
    rid: String, username: String, amount: Number, method: String,
    date: { type: Date, default: Date.now }, status: { type: String, default: 'pending' },
    processedAt: Date
});
const WdrSchema = new mongoose.Schema({
    rid: String, username: String, amount: Number, upiId: String,
    date: { type: Date, default: Date.now }, status: { type: String, default: 'pending' },
    processedAt: Date
});

const User = mongoose.model('User', UserSchema);
const Tx = mongoose.model('Tx', TxSchema);
const Dep = mongoose.model('Dep', DepSchema);
const Wdr = mongoose.model('Wdr', WdrSchema);

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);
const mapDep = d => ({ id: d.rid, username: d.username, amount: d.amount, method: d.method, date: d.date, status: d.status });
const mapWdr = w => ({ id: w.rid, username: w.username, amount: w.amount, upiId: w.upiId, date: w.date, status: w.status });

// ---------- AUTH ----------
async function authHandler(req, res) {
    const { username, password } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const hash = hashPassword(password);
    let user = await User.findOne({ username });
    if (user) {
        if (user.passwordHash) {
            if (user.passwordHash !== hash) return res.status(401).json({ error: '❌ Wrong password for this account!' });
            return res.json({ success: true, message: 'Welcome back, ' + username + '!', user: { username, balance: user.balance }, isNew: false });
        }
        user.passwordHash = hash; await user.save();
        return res.json({ success: true, message: 'Account claimed! Password set for ' + username, user: { username, balance: user.balance }, isNew: false, claimed: true });
    }
    user = await User.create({ username, passwordHash: hash, balance: 1000 });
    await Tx.create({ username, type: 'Welcome Bonus', amount: 1000, isPositive: true });
    res.json({ success: true, message: '🎉 Account created! Welcome bonus: ₹1,000', user: { username, balance: 1000 }, isNew: true });
}
app.post('/api/register', authHandler);
app.post('/api/login', authHandler);

app.get('/api/balance/:username', async (req, res) => {
    const u = await User.findOne({ username: req.params.username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ username: u.username, balance: u.balance });
});

app.post('/api/deposit-request', async (req, res) => {
    const { username, amount, method } = req.body;
    if (!username || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });
    if (!(await User.findOne({ username }))) return res.status(404).json({ error: 'User not found' });
    const rid = newId();
    await Dep.create({ rid, username, amount, method: method || 'UPI' });
    res.json({ success: true, message: 'Deposit request submitted.', requestId: rid });
});

app.post('/api/bet', async (req, res) => {
    const { username, amount, color } = req.body;
    const u = await User.findOne({ username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
    u.balance -= amount; await u.save();
    await Tx.create({ username, type: `Bet (${String(color).toUpperCase()})`, amount, isPositive: false });
    res.json({ success: true, newBalance: u.balance });
});

app.post('/api/win', async (req, res) => {
    const { username, amount, color } = req.body;
    const u = await User.findOne({ username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.balance += amount; await u.save();
    await Tx.create({ username, type: `Win (${String(color).toUpperCase()})`, amount, isPositive: true });
    res.json({ success: true, newBalance: u.balance });
});

app.post('/api/withdraw-request', async (req, res) => {
    const { username, amount, upiId } = req.body;
    if (!username || !amount || amount <= 0 || !upiId) return res.status(400).json({ error: 'Invalid withdrawal request' });
    const u = await User.findOne({ username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
    const rid = newId();
    await Wdr.create({ rid, username, amount, upiId });
    res.json({ success: true, message: 'Withdrawal request submitted.', requestId: rid });
});

app.get('/api/history/:username', async (req, res) => {
    const list = await Tx.find({ username: req.params.username }).sort({ _id: -1 }).limit(20);
    res.json({ transactions: list.map(t => ({ username: t.username, type: t.type, amount: t.amount, date: t.date, isPositive: t.isPositive })) });
});

// ---------- ADMIN ----------
app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true, message: 'Welcome, Admin!' });
    else res.status(401).json({ error: 'Wrong password' });
});
app.get('/api/admin/players', async (req, res) => {
    const users = await User.find({});
    res.json({ players: users.map(u => ({ username: u.username, balance: u.balance, createdAt: u.createdAt })) });
});
app.get('/api/admin/pending', async (req, res) => {
    const list = await Dep.find({ status: 'pending' }).sort({ _id: -1 });
    res.json({ pending: list.map(mapDep) });
});
app.post('/api/admin/approve', async (req, res) => {
    const d = await Dep.findOne({ rid: req.body.requestId, status: 'pending' });
    if (!d) return res.status(404).json({ error: 'Request not found or already processed' });
    const u = await User.findOne({ username: d.username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.balance += d.amount; await u.save();
    d.status = 'approved'; d.processedAt = new Date(); await d.save();
    await Tx.create({ username: d.username, type: `Deposit Approved (${d.method})`, amount: d.amount, isPositive: true });
    res.json({ success: true, newBalance: u.balance });
});
app.post('/api/admin/reject', async (req, res) => {
    const d = await Dep.findOne({ rid: req.body.requestId });
    if (!d) return res.status(404).json({ error: 'Request not found' });
    d.status = 'rejected'; d.processedAt = new Date(); await d.save();
    res.json({ success: true });
});
app.get('/api/admin/withdrawals', async (req, res) => {
    const list = await Wdr.find({ status: 'pending' }).sort({ _id: -1 });
    res.json({ pending: list.map(mapWdr) });
});
app.post('/api/admin/approve-withdrawal', async (req, res) => {
    const w = await Wdr.findOne({ rid: req.body.requestId, status: 'pending' });
    if (!w) return res.status(404).json({ error: 'Request not found or already processed' });
    const u = await User.findOne({ username: w.username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.balance -= w.amount; await u.save();
    w.status = 'approved'; w.processedAt = new Date(); await w.save();
    await Tx.create({ username: w.username, type: `Withdrawal Approved (UPI: ${w.upiId})`, amount: w.amount, isPositive: false });
    res.json({ success: true, newBalance: u.balance });
});
app.post('/api/admin/reject-withdrawal', async (req, res) => {
    const w = await Wdr.findOne({ rid: req.body.requestId });
    if (!w) return res.status(404).json({ error: 'Request not found' });
    w.status = 'rejected'; w.processedAt = new Date(); await w.save();
    res.json({ success: true });
});
app.post('/api/admin/allot', async (req, res) => {
    const { username, amount, reason } = req.body;
    if (!username || !amount) return res.status(400).json({ error: 'Missing data' });
    const u = await User.findOne({ username });
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.balance += amount; await u.save();
    await Tx.create({ username, type: `Admin Allotment: ${reason || 'Bonus'}`, amount, isPositive: true });
    res.json({ success: true, newBalance: u.balance });
});
app.get('/api/admin/transactions', async (req, res) => {
    const list = await Tx.find({}).sort({ _id: -1 }).limit(50);
    res.json({ transactions: list.map(t => ({ username: t.username, type: t.type, amount: t.amount, date: t.date, isPositive: t.isPositive })) });
});

// ---------- STATIC PAGES ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- START (only after DB connects) ----------
const URI = process.env.MONGODB_URI;
if (!URI) { console.error('❌ MONGODB_URI env var missing!'); process.exit(1); }
mongoose.connect(URI)
    .then(() => app.listen(PORT, () => console.log(`🎰 Casino live on port ${PORT}`)))
    .catch(err => { console.error('❌ DB connection failed:', err.message); process.exit(1); });
