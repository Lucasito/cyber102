/** Избранное содержит только ID событий. Ограничиваем объём и не доверяем содержимому хранилища. */
export const FAVORITES_KEY = "afisha-rb:favorites:v1";
export const MAX_FAVORITES = 100;
export const EVENT_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function parseFavoriteIds(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && EVENT_ID.test(id)))].slice(0, MAX_FAVORITES) : [];
  } catch { return []; }
}

export function toggleFavoriteId(ids: string[], id: string) {
  if (!EVENT_ID.test(id)) throw new Error("invalid_id");
  if (ids.includes(id)) return ids.filter((v) => v !== id);
  if (ids.length >= MAX_FAVORITES) throw new Error("favorites_limit");
  return [...ids, id];
}
