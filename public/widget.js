/* Виджет афиши культуры РБ. Подключение на любом сайте:
 *   <div data-afisha-widget data-city="Уфа" data-limit="5"></div>
 *   <script src="https://<домен-афиши>/widget.js" async></script>
 * Работает через iframe — не вмешивается в стили и скрипты сайта. */
(function () {
  var src = document.currentScript && document.currentScript.src;
  var origin = src ? new URL(src).origin : "";
  var attrs = { city: "city", category: "category", limit: "limit", age: "age", priceMax: "price-max", free: "free" };
  document.querySelectorAll("[data-afisha-widget]").forEach(function (el) {
    var params = new URLSearchParams();
    Object.keys(attrs).forEach(function (k) {
      var v = el.getAttribute("data-" + attrs[k]);
      if (v) params.set(k, v);
    });
    var f = document.createElement("iframe");
    f.src = origin + "/widget?" + params.toString();
    f.title = "Афиша культуры Башкортостана";
    f.loading = "lazy";
    f.style.cssText = "width:100%;border:0;min-height:" + (el.getAttribute("data-height") || "480") + "px";
    el.appendChild(f);
  });
})();
