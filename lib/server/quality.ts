import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

export const QUALITY_ISSUES = { all: "Все проблемы", price: "Не указана цена", age: "Не указан возраст", address: "Место уточняется", source: "Проверить источник" } as const;
export type QualityIssue = keyof typeof QUALITY_ISSUES;
type Options = Partial<Record<"issue" | "q" | "days" | "publication" | "page", string | string[]>>;
type Counts = { total: number; affected: number; price: number; age: number; address: number; source: number };
export type QualityEvent = {
  id: string; title: string; startsAt: Date; endsAt: Date | null; publication: string;
  venueId: string | null; venueName: string | null; city: string | null; address: string | null;
  missingPrice: boolean; missingAge: boolean; missingAddress: boolean; missingSource: boolean; sourceError: boolean;
};
const PAGE = 30;

/** Только сведения из БД: ошибки последнего сбора не выдаём за новую проверку доступности URL. */
export async function qualityReport(options: Options = {}, now = new Date()) {
  const input = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const issue: QualityIssue = Object.hasOwn(QUALITY_ISSUES, input.issue ?? "") ? input.issue as QualityIssue : "all";
  const q = (input.q ?? "").trim().slice(0, 100);
  const days = input.days === "7" || input.days === "all" ? input.days : "30";
  const publication = input.publication === "all" || input.publication === "draft" ? input.publication : "published";
  const horizon = days === "all" ? Prisma.empty : Prisma.sql`AND e."startsAt" < ${new Date(now.getTime() + Number(days) * 86_400_000)}`;
  const scope = publication === "all" ? Prisma.empty : Prisma.sql`AND e.publication = ${publication === "draft" ? "DRAFT" : "PUBLISHED"}::"Publication"`;
  // Literal substring search, without treating user's % or _ as SQL wildcards.
  const search = q ? Prisma.sql`AND position(lower(${q}) in lower(concat_ws(' ', e.title, v.name, v.city))) > 0` : Prisma.empty;
  const checks = Prisma.sql`WITH checks AS (
    SELECT e.id, e.title, e."startsAt", e."endsAt", e.publication::text, e."venueId", v.name AS "venueName", v.city, v.address,
      e."priceMin" IS NULL AS "missingPrice", e."ageLimit" IS NULL AS "missingAge",
      (v.id IS NULL OR trim(coalesce(v.address, '')) = '' OR v.approx OR v.lat IS NULL OR v.lon IS NULL) AS "missingAddress",
      NOT EXISTS (SELECT 1 FROM "EventSource" es WHERE es."eventId" = e.id AND es.url ~* '^https?://[^/[:space:]]+') AS "missingSource",
      EXISTS (
        SELECT 1 FROM "EventSource" es JOIN "Source" s ON s.code = es.source
        WHERE es."eventId" = e.id AND (
          (s."lastStatus" = 'error' AND s."lastRunAt" >= es."fetchedAt") OR EXISTS (
            SELECT 1 FROM "SourceItem" si WHERE si."sourceId" = s.id AND si.status = 'error'
              AND (si."eventId" = e.id OR si.link = es.url)
              AND coalesce(si."checkedAt", si."updatedAt") >= es."fetchedAt"
          )
        )
      ) AS "sourceError"
    FROM "Event" e LEFT JOIN "Venue" v ON v.id = e."venueId"
    WHERE e.status NOT IN ('PAST', 'CANCELLED') AND (e."startsAt" >= ${now} OR e."endsAt" >= ${now})
      ${horizon} ${scope} ${search}
  )`;
  const anyIssue = Prisma.sql`("missingPrice" OR "missingAge" OR "missingAddress" OR "missingSource" OR "sourceError")`;
  const predicates = {
    all: anyIssue, price: Prisma.sql`"missingPrice"`, age: Prisma.sql`"missingAge"`, address: Prisma.sql`"missingAddress"`, source: Prisma.sql`("missingSource" OR "sourceError")`,
  };
  const [counts] = await db.$queryRaw<Counts[]>(Prisma.sql`${checks} SELECT
    count(*)::int AS total, count(*) FILTER (WHERE ${anyIssue})::int AS affected,
    count(*) FILTER (WHERE "missingPrice")::int AS price, count(*) FILTER (WHERE "missingAge")::int AS age,
    count(*) FILTER (WHERE "missingAddress")::int AS address, count(*) FILTER (WHERE "missingSource" OR "sourceError")::int AS source
    FROM checks`);
  const total = issue === "all" ? counts.affected : counts[issue];
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(input.page ?? "1", 10) || 1));
  const items = await db.$queryRaw<QualityEvent[]>(Prisma.sql`${checks} SELECT * FROM checks WHERE ${predicates[issue]}
    ORDER BY greatest("startsAt", ${now}) ASC,
      ("missingPrice"::int + "missingAge"::int + "missingAddress"::int + ("missingSource" OR "sourceError")::int) DESC, id ASC
    LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`);
  return { items, counts, total, pages, page, issue, q, days, publication, now };
}
