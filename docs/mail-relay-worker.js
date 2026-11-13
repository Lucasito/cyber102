// Cloudflare Worker — посредник для писем афиши (SMTP по HTTPS).
// Зачем: хостинг сервера закрыл исходящие почтовые порты (25, 465, 587), а Cloudflare их открывает (кроме 25).
// Сервер отправляет сюда POST с письмом и настройками SMTP из админки; воркер сам подключается к SMTP
// (например, smtp.yandex.ru:465) и отправляет письмо. Настройки SMTP хранятся в админке, у воркера — только секрет.
//
// Установка (один раз):
//   1. dash.cloudflare.com → Workers & Pages → Create → Create Worker → имя, например afisha-mail → Deploy.
//   2. Edit code → вставить этот файл целиком → Deploy.
//   3. Settings → Variables and Secrets → Add → тип Secret, имя SECRET, значение — длинная случайная строка.
//   4. Админка афиши → «Почта» → «Посредник»: адрес воркера (https://afisha-mail.<аккаунт>.workers.dev) и тот же секрет.
//
// Запрос: POST, заголовок Authorization: Bearer <SECRET>, тело JSON:
//   { host, port, secure, user, pass, from, fromName, to, subject, text }
// Ответ: { ok: true } или { ok: false, error } с кодом 502.

import { connect } from "cloudflare:sockets";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("afisha mail relay", { status: 200 });
    if (!env.SECRET || request.headers.get("authorization") !== `Bearer ${env.SECRET}`) return new Response("forbidden", { status: 403 });
    let m;
    try {
      m = await request.json();
    } catch {
      return Response.json({ ok: false, error: "bad json" }, { status: 400 });
    }
    if (!m.host || !m.port || !EMAIL.test(m.from || "") || !EMAIL.test(m.to || "")) return Response.json({ ok: false, error: "bad message" }, { status: 400 });
    try {
      await sendSmtp(m);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message ? e.message : e) }, { status: 502 });
    }
  },
};

async function sendSmtp(m) {
  const implicitTls = m.secure !== false; // 465 — TLS сразу; иначе STARTTLS (587)
  let socket = connect({ hostname: m.host, port: Number(m.port) }, { secureTransport: implicitTls ? "on" : "starttls" });
  let io = channel(socket);
  try {
    await io.expect(220);
    await io.cmd("EHLO afisha", 250);
    if (!implicitTls) {
      await io.cmd("STARTTLS", 220);
      io.release();
      socket = socket.startTls();
      io = channel(socket);
      await io.cmd("EHLO afisha", 250);
    }
    if (m.user) {
      await io.cmd("AUTH LOGIN", 334);
      await io.cmd(b64(m.user), 334);
      await io.cmd(b64(m.pass || ""), 235);
    }
    await io.cmd(`MAIL FROM:<${m.from}>`, 250);
    await io.cmd(`RCPT TO:<${m.to}>`, 250);
    await io.cmd("DATA", 354);
    await io.write(message(m) + "\r\n.\r\n");
    await io.expect(250);
    await io.cmd("QUIT", 221).catch(() => {});
  } finally {
    socket.close().catch(() => {});
  }
}

/** Чтение ответов SMTP (многострочных: «250-…», последняя строка «250 …») и запись команд. */
function channel(socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  async function reply() {
    for (;;) {
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          buf = lines.slice(i + 1).join("\r\n");
          return lines.slice(0, i + 1).join("\n");
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP: соединение закрыто");
      buf += dec.decode(value, { stream: true });
    }
  }
  const io = {
    async expect(code) {
      const r = await reply();
      if (!r.startsWith(String(code))) throw new Error(`SMTP: ${r}`);
      return r;
    },
    async write(s) {
      await writer.write(enc.encode(s));
    },
    async cmd(s, code) {
      await writer.write(enc.encode(s + "\r\n"));
      return io.expect(code);
    },
    release() {
      reader.releaseLock();
      writer.releaseLock();
    },
  };
  return io;
}

function b64(s) {
  const bytes = new TextEncoder().encode(String(s));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function message(m) {
  const word = (s) => `=?UTF-8?B?${b64(s)}?=`;
  const from = m.fromName ? `${word(m.fromName)} <${m.from}>` : m.from;
  return [
    `From: ${from}`,
    `To: <${m.to}>`,
    `Subject: ${word(m.subject || "")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${m.from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.text || "").replace(/.{1,76}/g, "$&\r\n"),
  ].join("\r\n");
}
