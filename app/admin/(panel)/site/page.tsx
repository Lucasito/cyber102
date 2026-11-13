import { PageTitle, Section } from "@/components/admin/blocks";
import { LocalizationUpload } from "@/components/admin/localization-upload";
import { ActionButton, Field, Input, SettingsForm, Textarea } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { DEFAULT_EXAMPLES, DEFAULT_HERO_SUBTITLE, DEFAULT_HERO_TITLE, getSettings } from "@/lib/server/settings";
import { localizationEntries } from "@/lib/server/localization";
import { resetLocalization, saveSite } from "../../actions";

export default async function AdminSite() {
  await requireAdmin();
  const [site, loc] = await Promise.all([getSettings("site"), localizationEntries()]);
  const overridden = loc.filter((e) => e.overridden).length;
  return (
    <>
      <PageTitle title="Сайт" desc="Тексты главной страницы и объявления. Пустое поле — текст по умолчанию." />
      <Section>
        <SettingsForm action={saveSite}>
          <Field label="Заголовок">
            <Input name="heroTitle" defaultValue={site.heroTitle} placeholder={DEFAULT_HERO_TITLE} />
          </Field>
          <Field label="Подзаголовок">
            <Textarea name="heroSubtitle" defaultValue={site.heroSubtitle} placeholder={DEFAULT_HERO_SUBTITLE} />
          </Field>
          <Field label="Примеры запросов под строкой поиска" hint="По одному в строке, до шести.">
            <Textarea name="examples" rows={4} defaultValue={site.examples.join("\n")} placeholder={DEFAULT_EXAMPLES.join("\n")} />
          </Field>
          <Field label="Объявление над шапкой" hint="Например, о технических работах. Пусто — не показывать.">
            <Input name="notice" defaultValue={site.notice} />
          </Field>
        </SettingsForm>
      </Section>
      <Section
        title="Башкирская локализация"
        desc={`Тексты интерфейса сайта, жанры, быстрые ответы, примеры и фразы помощника — ${loc.length} строк, изменено из админки: ${overridden}. Названия и описания событий не переводятся.`}
      >
        <div className="space-y-4">
          <div className="space-y-1 text-sm text-stone-600">
            <p>
              1. <a href="/admin/i18n/export" className="font-medium text-[var(--brand)] underline">Скачать CSV</a> — первый столбец русский, второй башкирский
              (UTF-8, разделитель «;», открывается в Excel).
            </p>
            <p>2. Исправьте второй столбец. Первый не меняйте — по нему находится строка. Переменные в фигурных скобках, например {"{n}"}, оставьте как есть.</p>
            <p>3. Сохраните как «CSV UTF-8» и загрузите. Файл сначала проверяется: при ошибке не меняется ничего, отчёт покажет строки с ошибками.</p>
          </div>
          <LocalizationUpload />
          {overridden > 0 && (
            <ActionButton action={resetLocalization} confirm="Вернуть встроенный башкирский перевод? Загруженные правки будут удалены.">
              Вернуть встроенный перевод
            </ActionButton>
          )}
        </div>
      </Section>
    </>
  );
}
