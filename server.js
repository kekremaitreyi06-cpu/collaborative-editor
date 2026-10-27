require("dotenv").config();

const express = require("express");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_this_secret";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], documents: [] }, null, 2));
}
let store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

function saveStore() {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}
function signToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!token) throw new Error("Missing token");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Please log in to continue." });
  }
}
function canAccess(doc, userId) {
  return doc && (doc.ownerId === userId || doc.collaborators.includes(userId));
}
function getDoc(doc) {
  return {
    id: doc.id, title: doc.title, content: doc.content,
    ownerId: doc.ownerId, collaborators: doc.collaborators,
    updatedAt: doc.updatedAt
  };
}
function safeText(value, max = 100000) {
  return typeof value === "string" && value.length <= max;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "collaborative-editor", timestamp: new Date().toISOString() });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 2 ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Provide a name, valid email, and password of at least 8 characters." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (store.users.some(u => u.email === normalizedEmail)) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  const user = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 60),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12)
  };
  store.users.push(user);
  saveStore();
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = store.users.find(u => u.email === String(email || "").trim().toLowerCase());
  if (!user || typeof password !== "string" || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = store.users.find(u => u.id === req.user.sub);
  if (!user) return res.status(401).json({ error: "Account not found." });
  res.json({ user: publicUser(user) });
});

app.get("/api/documents", auth, (req, res) => {
  const docs = store.documents.filter(d => canAccess(d, req.user.sub)).map(getDoc);
  res.json(docs);
});

app.post("/api/documents", auth, (req, res) => {
  const { title } = req.body || {};
  if (typeof title !== "string" || !title.trim() || title.length > 120) {
    return res.status(400).json({ error: "Title is required and must be at most 120 characters." });
  }
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomUUID(), title: title.trim(), content: "",
    ownerId: req.user.sub, collaborators: [], updatedAt: now
  };
  store.documents.push(doc);
  saveStore();
  res.status(201).json({ document: getDoc(doc) });
});

app.get("/api/documents/:id", auth, (req, res) => {
  const doc = store.documents.find(d => d.id === req.params.id);
  if (!canAccess(doc, req.user.sub)) return res.status(404).json({ error: "Document not found." });
  res.json({ document: getDoc(doc) });
});

app.patch("/api/documents/:id", auth, (req, res) => {
  const doc = store.documents.find(d => d.id === req.params.id);
  if (!canAccess(doc, req.user.sub)) return res.status(404).json({ error: "Document not found." });
  const { title, content } = req.body || {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim() || title.length > 120)
      return res.status(400).json({ error: "Title must be a non-empty string of at most 120 characters." });
    doc.title = title.trim();
  }
  if (content !== undefined) {
    if (!safeText(content)) return res.status(400).json({ error: "Content must be text under 100,000 characters." });
    doc.content = content;
  }
  doc.updatedAt = new Date().toISOString();
  saveStore();
  res.json({ document: getDoc(doc) });
});

app.delete("/api/documents/:id", auth, (req, res) => {
  const index = store.documents.findIndex(d => d.id === req.params.id && d.ownerId === req.user.sub);
  if (index < 0) return res.status(404).json({ error: "Document not found or you are not the owner." });
  const [deleted] = store.documents.splice(index, 1);
  saveStore();
  io.to(deleted.id).emit("document:deleted", { id: deleted.id });
  res.status(204).end();
});

app.post("/api/documents/:id/share", auth, (req, res) => {
  const doc = store.documents.find(d => d.id === req.params.id && d.ownerId === req.user.sub);
  if (!doc) return res.status(404).json({ error: "Document not found or you are not the owner." });
  const { email } = req.body || {};
  if (typeof email !== "string") return res.status(400).json({ error: "Collaborator email is required." });
  const user = store.users.find(u => u.email === email.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: "No registered user found with that email." });
  if (user.id === doc.ownerId) return res.status(400).json({ error: "You already own this document." });
  if (!doc.collaborators.includes(user.id)) doc.collaborators.push(user.id);
  doc.updatedAt = new Date().toISOString();
  saveStore();
  res.json({ message: "Document shared successfully.", collaborator: publicUser(user) });
});

const socketUser = new Map();
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication required"));
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", socket => {
  socket.on("document:join", ({ documentId } = {}, callback = () => {}) => {
    const doc = store.documents.find(d => d.id === documentId);
    if (!canAccess(doc, socket.user.sub)) return callback({ error: "Document not found or access denied." });
    for (const room of socket.rooms) {
      if (room !== socket.id && store.documents.some(d => d.id === room)) socket.leave(room);
    }
    socket.join(doc.id);
    socketUser.set(socket.id, { userId: socket.user.sub, name: socket.user.name, documentId: doc.id });
    callback({ document: getDoc(doc) });
    io.to(doc.id).emit("presence:update", presenceFor(doc.id));
  });

  socket.on("document:change", ({ documentId, content, clientVersion } = {}, callback = () => {}) => {
    const doc = store.documents.find(d => d.id === documentId);
    if (!canAccess(doc, socket.user.sub) || !socket.rooms.has(documentId))
      return callback({ error: "Join this document before editing." });
    if (!safeText(content)) return callback({ error: "Invalid document content." });
    // Last-write-wins snapshot model for this starter. For production, replace with Yjs/CRDT operations.
    doc.content = content;
    doc.updatedAt = new Date().toISOString();
    saveStore();
    socket.to(documentId).emit("document:change", {
      documentId, content, clientVersion, updatedAt: doc.updatedAt,
      user: { id: socket.user.sub, name: socket.user.name }
    });
    callback({ ok: true, updatedAt: doc.updatedAt });
  });

  socket.on("cursor:update", ({ documentId, position } = {}) => {
    const doc = store.documents.find(d => d.id === documentId);
    if (!canAccess(doc, socket.user.sub) || !socket.rooms.has(documentId)) return;
    socket.to(documentId).emit("cursor:update", {
      documentId, position: Math.max(0, Number(position) || 0),
      user: { id: socket.user.sub, name: socket.user.name }
    });
  });

  socket.on("disconnect", () => {
    const info = socketUser.get(socket.id);
    socketUser.delete(socket.id);
    if (info) io.to(info.documentId).emit("presence:update", presenceFor(info.documentId));
  });
});

function presenceFor(documentId) {
  const users = [];
  for (const [socketId, info] of socketUser.entries()) {
    if (info.documentId === documentId) users.push({ socketId, id: info.userId, name: info.name });
  }
  return users;
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Collaborative Editor running on http://localhost:${PORT}`);
});
