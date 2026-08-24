const http = require("http");
const fs = require("fs");

const MAP_FILE = "/opt/postal/apps-map.json";

const server = http.createServer((req, res) => {
  // Extract app name from path (e.g., "/microsoft" -> "microsoft")
  const urlParts = req.url.split("/").filter(Boolean);
  const appName = urlParts[0];

  if (!appName) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Missing app name in URL path");
  }

  try {
    const map = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
    const targetDomain = map[appName];

    if (targetDomain) {
      // 302 Found redirect to current active domain
      res.writeHead(302, { Location: `https://${targetDomain}` });
      return res.end();
    }
  } catch (err) {
    console.error("Error reading map file:", err);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("App mapping not found");
});

server.listen(3005, () => {
  console.log("Central router running on port 3005");
});
