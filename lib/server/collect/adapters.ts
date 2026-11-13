import "server-only";

// Индивидуальные парсеры — для сайтов, у которых нет ни ленты, ни разметки, и HTML нужно разбирать по-своему.
// Парсер получает адрес источника и возвращает строки импорта (поля как в универсальном формате, /docs/format).
// Новый парсер: функция ниже + запись в ADAPTERS; в админке он появится в списке у типа «Индивидуальный парсер».

export type Adapter = {
  name: string;
  description: string;
  run: (url: string) => Promise<Record<string, unknown>[]>;
};

export const ADAPTERS: Record<string, Adapter> = {};
