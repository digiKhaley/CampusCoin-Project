export function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 2 MB)" });
  if (err?.name === "MulterError") return res.status(400).json({ error: err.message });

  // Prisma known errors
  if (err?.code === "P2002") return res.status(409).json({ error: "That already exists" });
  if (err?.code === "P2025") return res.status(404).json({ error: "Not found" });
  if (err?.code === "P2003") return res.status(409).json({ error: "This item is still referenced by other data" });

  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}
