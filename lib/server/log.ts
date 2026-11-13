import "server-only";

// Структурные логи (ТЗ 6.1, 10): одна JSON-строка на событие, с идентификатором запроса для сквозной трассировки.
// Персональные данные в лог не пишем: ни текстов пользователей, ни контактов, ни идентификаторов в мессенджерах.

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Сообщение ошибки без стека и без лишнего — для лога и ответа. */
export const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
