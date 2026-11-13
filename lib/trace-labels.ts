// Подписи для трасс агента в админке.

export const MODE_LABELS: Record<string, string> = {
  ai: "ИИ",
  mixed: "частично без ИИ",
  rules: "без ИИ (сбой)",
  limit: "без ИИ (лимит)",
};

export const SOURCE_LABELS: Record<string, string> = { site: "Сайт", api: "API", max: "MAX", telegram: "Telegram", eval: "Контрольный прогон" };

export const STEP_LABELS: Record<string, string> = {
  limit: "Лимит стоимости",
  parse: "Разбор запроса",
  rules: "Правила",
  clarify: "Уточняющий вопрос",
  search: "Поиск по базе",
  relax: "Ослабление условия",
  explain: "Объяснение",
};

export const RELAX_LABELS: Record<string, string> = { dates: "даты", category: "жанр", city: "город" };
