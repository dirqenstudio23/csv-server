const express = require("express");
const crypto  = require("crypto");
const app     = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb", type: "*/*" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const fileStore  = {};
const chunkStore = {};
const SECRET_KEY = process.env.SECRET_KEY || "ghl-csv-secret-2024";

function validateKey(req) {
  return req.query.key === SECRET_KEY;
}

// POST /chunk/start
app.post("/chunk/start", (req, res) => {
  if (!validateKey(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

  const fileName      = req.query.fileName      || "leads.csv";
  const reportMonth   = req.query.reportMonth   || "";
  const totalContacts = req.query.totalContacts || 0;
  const uploadId      = crypto.randomBytes(16).toString("hex");

  chunkStore[uploadId] = {
    chunks: [], fileName: decodeURIComponent(fileName),
    reportMonth: decodeURIComponent(reportMonth),
    totalContacts, createdAt: new Date()
  };

  return res.json({ success: true, uploadId, message: "Upload started" });
});

// POST /chunk/append
app.post("/chunk/append", (req, res) => {
  if (!validateKey(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

  const uploadId  = req.query.uploadId;
  const chunkData = req.query.chunk;

  if (!uploadId || !chunkStore[uploadId]) return res.status(400).json({ success: false, error: "Invalid uploadId" });
  if (!chunkData) return res.status(400).json({ success: false, error: "chunk required" });

  try {
    chunkStore[uploadId].chunks.push(decodeURIComponent(chunkData));
    return res.json({ success: true, uploadId, chunksTotal: chunkStore[uploadId].chunks.length });
  } catch(e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// POST /chunk/finalize
app.post("/chunk/finalize", (req, res) => {
  if (!validateKey(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

  const uploadId = req.query.uploadId;
  if (!uploadId || !chunkStore[uploadId]) return res.status(400).json({ success: false, error: "Invalid uploadId" });

  const upload     = chunkStore[uploadId];
  const csvContent = upload.chunks.join("");
  const fileId     = crypto.randomBytes(16).toString("hex");
  const expiresAt  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  fileStore[fileId] = {
    csvContent, fileName: upload.fileName, reportMonth: upload.reportMonth,
    totalContacts: upload.totalContacts, createdAt: new Date(), expiresAt
  };

  delete chunkStore[uploadId];

  const now = new Date();
  Object.keys(fileStore).forEach(id => { if (fileStore[id].expiresAt < now) delete fileStore[id]; });

  const downloadUrl = `${process.env.BASE_URL || "http://localhost:3000"}/download/${fileId}`;
  return res.json({ success: true, fileId, downloadUrl, fileName: upload.fileName, csvSize: csvContent.length, expiresAt: expiresAt.toISOString() });
});

// GET /download/:fileId
app.get("/download/:fileId", (req, res) => {
  const file = fileStore[req.params.fileId];
  if (!file) return res.status(404).send("File not found or expired.");
  if (new Date() > file.expiresAt) { delete fileStore[req.params.fileId]; return res.status(410).send("Expired."); }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  return res.send(file.csvContent);
});

// GET /health
app.get("/health", (req, res) => {
  res.json({ status: "ok", filesStored: Object.keys(fileStore).length, chunksActive: Object.keys(chunkStore).length, uptime: process.uptime() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CSV Chunk Server running on port ${PORT}`));
