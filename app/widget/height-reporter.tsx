"use client";

import { useEffect } from "react";

/** Сообщает странице-хозяину высоту виджета, чтобы iframe был без прокрутки (см. public/widget.js). */
export function HeightReporter({ wid }: { wid: string }) {
  useEffect(() => {
    if (window.parent === window) return;
    // Высота содержимого (main), а не документа: документ не бывает ниже фрейма, и виджет не смог бы уменьшиться
    const main = document.querySelector("main");
    if (!main) return;
    const send = () => window.parent.postMessage({ type: "afisha-widget-height", wid, height: main.getBoundingClientRect().bottom + 8 }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(main);
    send();
    return () => ro.disconnect();
  }, [wid]);
  return null;
}
