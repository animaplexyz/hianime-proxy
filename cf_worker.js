export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('origin') || "*";
        
        const allowedOriginsStr = env.ALLOWED_ORIGINS || "*";
        const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim());
        const isAllowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin) || allowedOrigins.length === 0;

        if (request.method === "OPTIONS") {
            const h = new Headers();
            h.set('Access-Control-Allow-Origin', isAllowed ? origin : '*');
            h.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
            h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range');
            h.set('Access-Control-Allow-Credentials', 'true');
            return new Response(null, { status: 204, headers: h });
        }

        if (!isAllowed) {
            return new Response("Forbidden: Origin not allowed by Animaple Proxy.", { status: 403 });
        }

        const targetUrlStr = url.searchParams.get('url');
        if (!targetUrlStr) {
            return new Response("Error: Missing 'url' parameter.", { status: 400 });
        }

        try {
            const targetUrl = new URL(targetUrlStr);
            
            const upstreamHeaders = new Headers({
                "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin": env.DEFAULT_ORIGIN || "https://hianime.to",
                "Referer": env.DEFAULT_REFERER || "https://megacloud.tv/" // Referer bawaan
            });

            // Timpa Referer melalui URL parameters jika ada
            const headersParam = url.searchParams.get('headers');
            if (headersParam) {
                try {
                    const parsedHeaders = JSON.parse(headersParam);
                    for (const [key, value] of Object.entries(parsedHeaders)) {
                        upstreamHeaders.set(key, value);
                    }
                } catch(e) {}
            }

            if (request.headers.has('range')) {
                upstreamHeaders.set('range', request.headers.get('range'));
            }

            const response = await fetch(targetUrl.href, {
                method: request.method,
                headers: upstreamHeaders,
                redirect: 'follow'
            });

            const responseHeaders = new Headers(response.headers);
            responseHeaders.set('Access-Control-Allow-Origin', isAllowed ? origin : '*');
            responseHeaders.set('Access-Control-Allow-Credentials', 'true');
            responseHeaders.delete('x-frame-options');
            responseHeaders.delete('content-security-policy');

            if (!response.ok) {
                return new Response(response.body, { status: response.status, headers: responseHeaders });
            }

            const contentType = responseHeaders.get('content-type') || '';
            const isPlaylist = targetUrl.pathname.toLowerCase().endsWith('.m3u8') || contentType.includes('mpegurl');

            if (isPlaylist) {
                let content = await response.text();
                
                if (!content.trim().startsWith('#EXTM3U')) {
                    responseHeaders.set('Content-Type', 'text/plain');
                    return new Response(content, { status: 200, headers: responseHeaders });
                }
                
                content = content.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#EXT-X-VERSION') || trimmed === '#EXTM3U') return line;
                    
                    if (trimmed.startsWith('#')) {
                        return line.replace(/(URI\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, uri, suffix) => {
                            const absUrl = new URL(uri, targetUrl.href).href;
                            let proxyUrl = `${url.origin}${url.pathname}?url=${encodeURIComponent(absUrl)}`;
                            if (headersParam) proxyUrl += `&headers=${encodeURIComponent(headersParam)}`;
                            return `${prefix}${proxyUrl}${suffix}`;
                        });
                    }
                    
                    const absUrl = new URL(trimmed, targetUrl.href).href;
                    let proxyUrl = `${url.origin}${url.pathname}?url=${encodeURIComponent(absUrl)}`;
                    if (headersParam) proxyUrl += `&headers=${encodeURIComponent(headersParam)}`;
                    return proxyUrl;
                }).join('\n');
                
                responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
                return new Response(content, { status: 200, headers: responseHeaders });
            }

            return new Response(response.body, { status: 200, headers: responseHeaders });

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
    }
};