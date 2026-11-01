const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 4173);
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
const getAIProvider = () => (process.env.AI_PROVIDER || (process.env.RENDER ? 'gemini' : 'ollama')).toLowerCase();
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
};

const tutorRateLimits = new Map();
const sendJSON = (response, status, data) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(data));

async function handleTutor(request, response) {
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== request.headers.host) return sendJSON(response, 403, { error: 'Solicitud de origen no permitida.' }); }
    catch { return sendJSON(response, 403, { error: 'Solicitud de origen no válida.' }); }
  }
  const ip = request.socket.remoteAddress || 'local'; const now = Date.now();
  for (const [address, entry] of tutorRateLimits) if (entry.until <= now) tutorRateLimits.delete(address);
  const limit = tutorRateLimits.get(ip) || { count: 0, until: now + 60_000 };
  if (limit.count >= 12) return sendJSON(response, 429, { error: 'Se alcanzó el límite temporal de preguntas. Espera un minuto e inténtalo de nuevo.' });
  limit.count++; tutorRateLimits.set(ip, limit);

  let body = '';
  try {
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 128_000) return sendJSON(response, 413, { error: 'La conversación es demasiado larga. Inicia un chat nuevo.' });
    }
    const input = JSON.parse(body);
    if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 8 || input.messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 4_000) || input.messages.reduce((length, message) => length + message.content.length, 0) > 16_000 || input.messages.at(-1)?.role !== 'user') {
      return sendJSON(response, 400, { error: 'Escribe una pregunta válida para continuar.' });
    }
    const provider = getAIProvider();
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) return sendJSON(response, 503, { error: 'Falta configurar OPENAI_API_KEY en el archivo .env del servidor. La clave nunca va en el navegador.' });
    if (provider === 'gemini' && !process.env.GEMINI_API_KEY) return sendJSON(response, 503, { error: 'Falta añadir GEMINI_API_KEY en las variables Environment del servicio de Render. No pongas la clave en la página ni en GitHub.' });
    if (!['ollama', 'openai', 'gemini'].includes(provider)) return sendJSON(response, 503, { error: 'Proveedor de IA no válido. Usa ollama, gemini u openai.' });

    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45_000); timeout.unref?.();
    let apiResponse; let isOllama = provider === 'ollama';
    const systemInstruction = `Eres Tutor IA de StudyHelp, una plataforma educativa en español. Materia seleccionada: ${String(input.subject || 'General').slice(0, 50)}. Explica con claridad y paciencia para un estudiante. Guía paso a paso, usa ejemplos breves y pregunta si quiere practicar. No inventes datos; si no sabes algo, dilo. Para ejercicios, ayuda a razonar y explica el procedimiento. Usa Markdown sencillo cuando ayude.`;
    try {
      if (provider === 'gemini') {
        const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
        apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', signal: controller.signal,
          headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: input.messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
            generationConfig: { maxOutputTokens: 800 }
          })
        });
      } else {
        const messages = [
          { role: 'system', content: systemInstruction },
          ...input.messages.map(message => ({ role: message.role, content: message.content }))
        ];
        apiResponse = await fetch(isOllama ? `${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/v1/chat/completions` : 'https://api.openai.com/v1/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: { ...(isOllama ? {} : { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: isOllama ? (process.env.OLLAMA_MODEL || 'qwen3:1.7b') : (process.env.OPENAI_MODEL || 'gpt-6-astra'),
            messages,
            max_tokens: 800,
            ...(isOllama ? {} : { store: false })
          })
        });
      }
    } finally { clearTimeout(timeout); }
    const result = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      if (apiResponse.status === 401 && provider === 'openai') return sendJSON(response, 502, { error: 'OpenAI rechazó la clave configurada. Revisa OPENAI_API_KEY en el servidor.' });
      if (apiResponse.status === 429 && provider === 'openai') return sendJSON(response, 429, { error: 'OpenAI limitó temporalmente las solicitudes. Revisa el uso y la facturación de la cuenta API.' });
      if ([400, 401, 403].includes(apiResponse.status) && provider === 'gemini') return sendJSON(response, 502, { error: 'Google AI Studio rechazó la clave o no habilitó este modelo para el proyecto. Revisa GEMINI_API_KEY y el acceso al nivel gratuito.' });
      if (apiResponse.status === 429 && provider === 'gemini') return sendJSON(response, 429, { error: 'Se alcanzó el límite gratuito temporal de Gemini. Espera un momento e inténtalo más tarde.' });
      if (isOllama && (apiResponse.status === 404 || apiResponse.status === 400)) return sendJSON(response, 503, { error: `Ollama no encuentra el modelo ${process.env.OLLAMA_MODEL || 'qwen3:1.7b'}. En PowerShell ejecuta: ollama run ${process.env.OLLAMA_MODEL || 'qwen3:1.7b'}` });
      return sendJSON(response, 502, { error: 'El servicio de IA no pudo responder. Inténtalo de nuevo en un momento.' });
    }
    const answer = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').filter(Boolean).join('\n') || result.choices?.[0]?.message?.content || result.output_text || result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    if (!answer) return sendJSON(response, 502, { error: 'El servicio de IA devolvió una respuesta vacía. Vuelve a intentarlo.' });
    return sendJSON(response, 200, { answer });
  } catch (error) {
    if (error.name === 'AbortError') return sendJSON(response, 504, { error: 'La respuesta tardó demasiado. Vuelve a intentarlo.' });
    if (error instanceof SyntaxError) return sendJSON(response, 400, { error: 'No se pudo leer la pregunta enviada.' });
    return sendJSON(response, 500, { error: 'Ocurrió un problema al procesar la pregunta.' });
  }
}

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Solicitud no válida'); return; }
  if (request.method === 'GET' && pathname === '/api/tutor/status') {
    const provider = getAIProvider();
    if (provider === 'openai') { sendJSON(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), provider }); return; }
    if (provider === 'gemini') { sendJSON(response, 200, { configured: Boolean(process.env.GEMINI_API_KEY), provider, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' }); return; }
    const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
    fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/tags`, { signal: AbortSignal.timeout(1800) })
      .then(result => result.json()).then(data => {
        const available = (data.models || []).some(item => item.name === model || item.name?.startsWith(`${model}:`));
        sendJSON(response, 200, { configured: available, provider, model, ollamaRunning: true });
      }).catch(() => sendJSON(response, 200, { configured: false, provider, model, ollamaRunning: false }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/tutor') { handleTutor(request, response); return; }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Método no permitido'); return;
  }
  const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Acceso denegado'); return;
  }
  const relativeSegments = path.relative(root, filename).split(path.sep);
  if (relativeSegments.some(segment => segment.startsWith('.'))) { response.writeHead(404).end('No encontrado'); return; }
  fs.stat(filename, (statError, stat) => {
    if (statError || !stat.isFile()) { response.writeHead(404).end('No encontrado'); return; }
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(filename).pipe(response);
  });
}).listen(port, '0.0.0.0', () => console.log(`StudyHelp está disponible en el puerto ${port}`));

