const express = require("express");
const crypto  = require("crypto");
const app     = express();

app.use(express.json({ limit: "10mb" }));

// In-memory storage — file tersimpan selama server hidup
const fileStore = {};

// Secret key untuk keamanan — ganti dengan string random Anda
const SECRET_KEY = process.env.SECRET_KEY || "ghl-csv-secret-2024";

// =============================================
// POST /upload — Terima CSV dari GHL
// =============================================
app.post("/upload", (req, res) => {
  try {
    const { secretKey, csvContent, fileName, reportMonth, totalContacts } = req.body;

    // Validasi secret key
    if (secretKey !== SECRET_KEY) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!csvContent || !fileName) {
      return res.status(400).json({ success: false, error: "csvContent and fileName required" });
    }

    // Generate unique ID untuk file
    const fileId      = crypto.randomBytes(16).toString("hex");
    const createdAt   = new Date();
    const expiresAt   = new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 hari

    // Simpan di memory
    fileStore[fileId] = {
      csvContent,
      fileName,
      reportMonth,
      totalContacts,
      createdAt,
      expiresAt
    };

    // Cleanup file yang sudah expired
    const now = new Date();
    Object.keys(fileStore).forEach(id => {
      if (fileStore[id].expiresAt < now) {
        delete fileStore[id];
      }
    });

    const downloadUrl = `${process.env.BASE_URL || "http://localhost:3000"}/download/${fileId}`;

    return res.json({
      success:     true,
      fileId:      fileId,
      downloadUrl: downloadUrl,
      fileName:    fileName,
      expiresAt:   expiresAt.toISOString()
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// GET /download/:fileId — Download CSV
// =============================================
app.get("/download/:fileId", (req, res) => {
  const { fileId } = req.params;
  const file = fileStore[fileId];

  if (!file) {
    return res.status(404).send("File not found or expired.");
  }

  // Cek expired
  if (new Date() > file.expiresAt) {
    delete fileStore[fileId];
    return res.status(410).send("File has expired.");
  }

  // Kirim file sebagai download
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  return res.send(file.csvContent);
});

// =============================================
// GET /health — Health check
// =============================================
app.get("/health", (req, res) => {
  res.json({
    status:     "ok",
    filesStored: Object.keys(fileStore).length,
    uptime:     process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CSV Server running on port ${PORT}`);
});
