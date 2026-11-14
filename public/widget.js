/* Виджет афиши культуры Башкортостана. Код с нужными настройками собирает конструктор: <домен-афиши>/docs/widget
 *   <div data-afisha-widget data-city="Уфа" data-period="weekend" data-limit="6"></div>
 *   <script src="https://<домен-афиши>/widget.js" async></script>
 * Все атрибуты data-* (кроме data-height) передаются виджету как параметры: data-price-max → priceMax и т. д.
 * data-height: число пикселей или "auto" (по умолчанию) — высота подстраивается под содержимое.
 * Оформление: data-layout, data-cols, data-img="0", data-theme="dark", data-bg, data-radius, data-font, data-accent, data-title;
 * data-lang="ba" — на башкирском; data-ask="1" — строка вопроса помощнику (открывает чат на сайте афиши в новой вкладке).
 * Работает через iframe — не вмешивается в стили и скрипты сайта, cookies не использует. */
(function () {
  var src = document.currentScript && document.currentScript.src;
  var origin = src ? new URL(src).origin : "";
  var frames = {};

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== "afisha-widget-height") return;
    var f = frames[e.data.wid];
    if (f) f.style.height = Math.ceil(e.data.height) + "px";
  });

  // Скрипт может стоять в <head> или выполниться раньше разметки (async) — ищем блоки, когда страница разобрана
  function init() {
  document.querySelectorAll("[data-afisha-widget]").forEach(function (el, i) {
    if (el.getAttribute("data-afisha-ready")) return;
    el.setAttribute("data-afisha-ready", "1");
    var params = new URLSearchParams();
    Object.keys(el.dataset).forEach(function (k) {
      if (k === "afishaWidget" || k === "afishaReady" || k === "height") return;
      if (el.dataset[k] !== "") params.set(k, el.dataset[k]);
    });
    var height = el.getAttribute("data-height") || "auto";
    var auto = height === "auto";
    var wid = "w" + i + "-" + Math.random().toString(36).slice(2, 8);
    if (auto) params.set("wid", wid);
    var f = document.createElement("iframe");
    f.src = origin + "/widget?" + params.toString();
    f.title = "Афиша культуры Башкортостана";
    f.loading = "lazy";
    f.style.cssText = "width:100%;border:0;display:block;height:" + (auto ? "480" : parseInt(height, 10) || 480) + "px";
    if (auto) frames[wid] = f;
    el.appendChild(f);
  });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
