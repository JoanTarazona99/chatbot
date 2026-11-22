"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT_MS);
const OLLAMA_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 60000;
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_MODEL = "qwen3:8b-q4_K_M";
const MAX_BODY_BYTES = 16 * 1024;
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"]
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function validateInput(body) {
  if (!body || typeof body.query !== "string" || !body.query.trim() || body.query.length > 1000) {
    return null;
  }
  if (!Array.isArray(body.faqs) || body.faqs.length < 1 || body.faqs.length > 30) {
    return null;
  }

  const ids = new Set();
  const faqs = [];
  for (const faq of body.faqs) {
    if (
      !faq
      || typeof faq.id !== "string"
      || !/^[a-z0-9-]{1,64}$/.test(faq.id)
      || ids.has(faq.id)
      || typeof faq.question !== "string"
      || !faq.question.trim()
      || faq.question.length > 300
    ) {
      return null;
    }
    ids.add(faq.id);
    faqs.push({ id: faq.id, question: faq.question });
  }

  return { query: body.query.trim(), faqs, ids };
}

async function matchFaq(request, response, body) {
  const input = validateInput(body);
  if (!input) {
    sendJson(response, 400, { error: "Некорректный запрос или каталог FAQ." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  response.on("close", () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });

  const schema = {
    type: "object",
    properties: {
      faqId: {
        type: ["string", "null"],
        enum: [...input.ids, null]
      }
    },
    required: ["faqId"],
    additionalProperties: false
  };
  const payload = {
    model: OLLAMA_MODEL,
    stream: false,
    think: true,
    format: schema,
    options: { temperature: 0 },
    messages: [
      {
        role: "system",
        content: "Определи, какая именно информация нужна пользователю. Выбирай faqId только если один из вопросов FAQ запрашивает ту же информацию и его ответ прямо решит запрос. Не выбирай ближайший вопрос лишь из-за общей темы. Если запрос о другой услуге, политике или информации, которой нет в вопросах FAQ, выбери null. Верни только JSON с единственным полем faqId; не отвечай на запрос."
      },
      {
        role: "user",
        content: JSON.stringify({
          query: input.query,
          faqs: input.faqs
        })
      }
    ]
  };

  try {
    const ollamaResponse = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!ollamaResponse.ok) {
      throw new Error(`Ollama returned HTTP ${ollamaResponse.status}.`);
    }

    const result = await ollamaResponse.json();
    let match;
    try {
      match = JSON.parse(result.message.content);
    } catch {
      sendJson(response, 200, { faqId: null });
      return;
    }

    const faqId = match
      && Object.keys(match).length === 1
      && Object.hasOwn(match, "faqId")
      && (match.faqId === null || input.ids.has(match.faqId))
      ? match.faqId
      : null;
    sendJson(response, 200, { faqId });
  } catch (error) {
    if (response.writableEnded || response.destroyed) {
      return;
    }
    console.error(`FAQ matching failed: ${error.message}`);
    sendJson(response, 200, { faqId: null });
  } finally {
    clearTimeout(timeout);
  }
}

function serveStatic(response, pathname) {
  const entry = STATIC_FILES[pathname];
  if (!entry) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const [filename, contentType] = entry;
  fs.readFile(path.join(__dirname, filename), (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to read local app file.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache"
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}`);
  if (request.method === "GET" && STATIC_FILES[url.pathname]) {
    serveStatic(response, url.pathname);
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/api/faq-match") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    await matchFaq(request, response, await readJsonBody(request));
  } catch (error) {
    sendJson(response, error.statusCode || 400, {
      error: error.statusCode === 413 ? "Слишком большой запрос." : "Некорректный JSON."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Учебный чат-бот доступен по адресу http://${HOST}:${PORT}/`);
  console.log(`Модель: ${OLLAMA_MODEL}; тайм-аут: ${OLLAMA_TIMEOUT_MS} мс.`);
});
