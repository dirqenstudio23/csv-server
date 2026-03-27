const express = require("express");
const crypto  = require("crypto");
const app     = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

// In-memory storage — file tersimpan selama server hidup
const fileStore = {};

// Secret key untuk keamanan — ganti dengan string random Anda
const SECRET_KEY = process.env.SECRET_KEY || "ghl-csv-secret-2024";

// =============================================
// POST /debug — Lihat apa yang GHL kirim
// =============================================
app.post("/debug", (req, res) => {
  console.log("=== DEBUG REQUEST ===");
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body type:", typeof req.body);
  console.log("Body keys:", Object.keys(req.body || {}));
  console.log("Body raw:", JSON.stringify(req.body).substring(0, 500));
  console.log("====================");

  return res.json({
    success:      true,
    bodyType:     typeof req.body,
    bodyKeys:     Object.keys(req.body || {}),
    bodyPreview:  JSON.stringify(req.body).substring(0, 500),
    secretReceived: req.body ? req.body.secretKey || "NOT FOUND" : "NO BODY"
  });
});

// =============================================
// POST /upload — Terima CSV dari GHL
// =============================================
app.post("/upload", (req, res) => {
  try {
    // Handle body yang mungkin double-stringified oleh GHL
    let parsedBody = req.body;
    if (typeof parsedBody === "string") {
      try { parsedBody = JSON.parse(parsedBody); } catch(e) {}
    }

    const { csvContent, fileName, reportMonth, totalContacts } = parsedBody;

    // Validasi secret key — cek dari query param ATAU body
    const secretKey = req.query.key || parsedBody.secretKey;
    if (secretKey !== SECRET_KEY) {
      return res.status(401).json({ 
        success: false, 
        error: "Unauthorized",
        receivedKey: secretKey ? secretKey.substring(0, 5) + "..." : "undefined",
        expectedKey: SECRET_KEY.substring(0, 5) + "..."
      });
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
