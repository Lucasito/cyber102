// Проверка настоящего браузера без расширений и пользовательского профиля, через Chrome DevTools Protocol.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

class Page {
  private next = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private socket: WebSocket;
  readonly errors: string[] = [];
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const p = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) p?.reject(new Error(message.error.message)); else p?.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params.exceptionDetails.text);
    });
  }
  async ready() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise<void>((resolve, reject) => { this.socket.addEventListener("open", () => resolve(), { once: true }); this.socket.addEventListener("error", () => reject(new Error("Браузер не открыл DevTools")), { once: true }); });
    await this.call("Page.enable"); await this.call("Runtime.enable"); await this.call("Network.enable");
  }
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.next;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`DevTools timeout: ${method}`)), 10000); })]) as T; }
    finally { clearTimeout(timer!); this.pending.delete(id); }
  }
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const r = await this.call<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async wait(expression: string) {
    for (let i = 0; i < 100; i++) { if (await this.evaluate<boolean>(expression).catch(() => false)) return; await new Promise((resolve) => setTimeout(resolve, 75)); }
    throw new Error(`Не дождались: ${expression}`);
  }
  async go(url: string) {
    await this.call("Page.navigate", { url });
    await this.wait(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`);
  }
  closeBrowser() { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ id: ++this.next, method: "Browser.close" })); }
  close() { this.socket.close(); }
}

export async function visitorBrowserChecks(baseUrl: string, fixture: { date: string; events: { id: string; title: string }[]; input: Record<string, string | number> }, check: (name: string, fn: () => Promise<unknown>) => Promise<void>) {
  let browserPath = process.env.TEST_BROWSER_PATH;
  if (!browserPath) for (const candidate of ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]) {
    try { await access(candidate); browserPath = candidate; break; } catch { /* следующий браузер */ }
  }
  if (!browserPath) throw new Error("Укажите путь Chromium-браузера в TEST_BROWSER_PATH.");
  await mkdir("test-results", { recursive: true });
  // Профиль за пределами проекта: Turbopack не должен читать заблокированные файлы Chromium.
  const profile = await mkdtemp(path.join(tmpdir(), "afisha-visitor-browser-"));
  const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const pages: Page[] = [];
  try {
    let port = "";
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0].trim(); if (port) break; } catch { /* запуск */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(port, "Браузер не запустился");
    async function newPage() {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      const target = await r.json(); const page = new Page(target.webSocketDebuggerUrl); await page.ready(); pages.push(page);
      await page.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
      await page.call("Network.setBlockedURLs", { urls: ["*://*.openfreemap.org/*", "*://*.openstreetmap.org/*"] });
      return page;
    }
    const page = await newPage();
    const [first, second] = fixture.events;
    await check("браузер сохраняет избранное после перезагрузки и не создаёт cookie", async () => {
      await page.go(`${baseUrl}/events/${first.id}`);
      await page.wait(`!!document.querySelector('main button[aria-label="В избранное"]')`);
      await page.evaluate(`document.querySelector('main button[aria-label="В избранное"]').click()`);
      await page.wait(`!!document.querySelector('main button[aria-label="Убрать из избранного"][aria-pressed="true"]')`);
      assert.deepEqual(await page.evaluate(`JSON.parse(localStorage.getItem('afisha-rb:favorites:v1'))`), [first.id]);
      await page.call("Page.reload"); await page.wait(`!!document.querySelector('main button[aria-label="Убрать из избранного"][aria-pressed="true"]')`);
      assert.equal((await page.call<{ cookies: unknown[] }>("Network.getCookies", { urls: [baseUrl] })).cookies.length, 0);
    });
    await check("избранное обновляется между вкладками и сравнивает события", async () => {
      await page.go(`${baseUrl}/favorites`); await page.wait(`!!document.querySelector('main a[href="/events/${first.id}"]')`);
      const other = await newPage(); await other.go(`${baseUrl}/events/${second.id}`);
      await other.wait(`!!document.querySelector('main button[aria-label="В избранное"]')`);
      await other.evaluate(`document.querySelector('main button[aria-label="В избранное"]').click()`);
      await page.wait(`!!document.querySelector('main a[href="/events/${second.id}"]')`);
      await page.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.includes('Сравнить события')).click()`);
      await page.wait(`document.querySelectorAll('main tbody tr').length === 2`);
      assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
      const screenshot = await page.call<{ data: string }>("Page.captureScreenshot", { format: "png" }); await writeFile("test-results/favorites-mobile.png", Buffer.from(screenshot.data, "base64"));
    });
    await check("шапка помещается на экране 320 px с обоими ботами и избранным", async () => {
      assert.equal(await page.evaluate(`document.querySelectorAll('header nav[aria-label="Боты"] a').length`), 2);
      await page.call("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
      assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
      assert.ok(await page.evaluate(`(() => { const logo = document.querySelector('header a[href="/"]'); return !!logo.getAttribute('aria-label') && logo.getBoundingClientRect().right + 4 <= logo.nextElementSibling.getBoundingClientRect().left; })()`));
      await page.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    });
    await check("недоступное localStorage сохраняет работоспособность без регистрации", async () => {
      const blocked = await newPage();
      await blocked.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError') } });` });
      await blocked.go(`${baseUrl}/events/${second.id}`); await blocked.wait(`!!document.querySelector('main button[aria-label="В избранное"]')`);
      await blocked.evaluate(`document.querySelector('main button[aria-label="В избранное"]').click()`);
      await blocked.wait(`!!document.querySelector('main button[aria-label="Убрать из избранного"]')`);
      assert.ok(await blocked.evaluate(`document.body.textContent.includes('Браузер не разрешает сохранение')`));
    });
    await check("виджет не добавляет избранное и не требует cookie", async () => {
      const widget = await newPage();
      await widget.call("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError') } });` });
      await widget.go(`${baseUrl}/widget`);
      assert.equal(await widget.evaluate(`document.querySelectorAll('button[aria-label="В избранное"]').length`), 0);
      assert.equal((await widget.call<{ cookies: unknown[] }>("Network.getCookies", { urls: [baseUrl] })).cookies.length, 0);
    });
    await check("мобильный план заменяет одну остановку, сохраняя остальные", async () => {
      const params = new URLSearchParams(Object.entries(fixture.input).map(([k, v]) => [k, String(v)]));
      await page.go(`${baseUrl}/plan?${params}`);
      await page.wait(`document.querySelectorAll('#plan ol article').length === 3`);
      const replace = await page.evaluate<string>(`document.querySelectorAll('#plan ol article')[1].querySelector('a[href*="keep="]').href`);
      await page.go(replace);
      await page.wait(`document.querySelectorAll('#plan ol article').length === 3`);
      const titles = await page.evaluate<string[]>(`[...document.querySelectorAll('#plan ol article h3')].map(h => h.textContent)`);
      assert.deepEqual(titles, [fixture.events[0].title, fixture.events[3].title, fixture.events[2].title]);
      assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
      const screenshot = await page.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile("test-results/plan-mobile.png", Buffer.from(screenshot.data, "base64"));
    });
    await check("новые страницы работают без необработанных ошибок JavaScript", async () => { assert.deepEqual(pages.flatMap((p) => p.errors), []); });
  } finally {
    pages[0]?.closeBrowser();
    for (const page of pages) page.close();
    if (browser.exitCode == null) {
      let timer: ReturnType<typeof setTimeout>;
      await Promise.race([once(browser, "exit"), new Promise((resolve) => { timer = setTimeout(resolve, 2000); })]);
      clearTimeout(timer!);
      if (browser.exitCode == null) { browser.kill(); await once(browser, "exit"); }
    }
  }
}
