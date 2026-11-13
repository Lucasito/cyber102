// Фоновые задачи сервера: циклы опроса ботов (каждый сам ждёт, пока бот выключен в админке)
// и периодические задачи — статусы прошедших событий, напоминания.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.MAX_MODE ?? "polling") === "polling") {
    const { startMaxPolling } = await import("@/lib/server/max");
    void startMaxPolling();
  }
  const { startTelegramPolling } = await import("@/lib/server/telegram");
  void startTelegramPolling();
  // Модули ботов уже импортированы — их отправщики напоминаний зарегистрированы
  const { startJobs } = await import("@/lib/server/jobs");
  startJobs();
}
