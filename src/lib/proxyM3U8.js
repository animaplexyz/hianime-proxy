import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || 8080;
const web_server_url = process.env.PUBLIC_URL || `http://${host}:${port}`;

export default async function proxyM3U8(url, headers, res) {
  try {
    const enhancedHeaders = {
        ...headers,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://hianime.to",
    };

    const req = await axios({
      method: 'GET',
      url: url,
      headers: enhancedHeaders,
      responseType: 'text'
    });

    if (!req || !req.data) {
        if (!res.headersSent) {
            res.writeHead(500);
            res.end("Error: Empty response from upstream server.");
        }
        return;
    }

    const m3u8 = req.data;
    const lines = m3u8.split("\n");
    const newLines = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) continue;

      if (trimmedLine.startsWith("#")) {
        if (trimmedLine.startsWith("#EXT-X-KEY:")) {
          const regex = /https?:\/\/[^\""\s]+/g;
          const match = regex.exec(trimmedLine);
          if (match && match[0]) {
             const rewrittenUrl = `${web_server_url}/ts-proxy?url=${encodeURIComponent(match[0])}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
             newLines.push(trimmedLine.replace(regex, rewrittenUrl));
          } else {
             newLines.push(trimmedLine);
          }
        } 
        // Tulis ulang link untuk audio terpisah (opsional, jika ada)
        else if (trimmedLine.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
          const regex = /https?:\/\/[^\""\s]+/g;
          const match = regex.exec(trimmedLine);
          if (match && match[0]) {
              const rewrittenUrl = `${web_server_url}/m3u8-proxy?url=${encodeURIComponent(match[0])}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
              newLines.push(trimmedLine.replace(regex, rewrittenUrl));
          } else {
              newLines.push(trimmedLine);
          }
        } 
        else {
          newLines.push(trimmedLine);
        }
      } 
      else {
        try {
          const uri = new URL(trimmedLine, url);
          const isPlaylist = uri.href.includes('.m3u8');
          const endpoint = isPlaylist ? '/m3u8-proxy' : '/ts-proxy';
          
          newLines.push(`${web_server_url}${endpoint}?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`);
        } catch (urlError) {
          newLines.push(trimmedLine);
        }
      }
    }

    const headersToRemove = [
      "Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers",
      "Access-Control-Max-Age", "Access-Control-Allow-Credentials", "Access-Control-Expose-Headers",
      "Access-Control-Request-Method", "Access-Control-Request-Headers", "Origin", "Vary", "Referer",
      "Server", "x-cache", "via", "x-amz-cf-pop", "x-amz-cf-id", "content-security-policy", "x-frame-options"
    ];
    headersToRemove.forEach((header) => res.removeHeader(header));

    if (!res.headersSent) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "*");
        res.writeHead(200);
        res.end(newLines.join("\n"));
    }

  } catch (err) {
    console.error("ProxyM3U8 Error:", err.message);
    
    if (!res.headersSent) {
        const statusCode = err.response ? err.response.status : 500;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(statusCode);
        res.end(err.message || "Upstream server error");
    }
  }
}
