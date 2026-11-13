import { PageTitle, Section } from "@/components/admin/blocks";
import { Field, Input, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { DEFAULT_EXAMPLES, DEFAULT_HERO_SUBTITLE, DEFAULT_HERO_TITLE, getSettings } from "@/lib/server/settings";
import { saveSite } from "../../actions";

export default async function AdminSite() {
  await requireAdmin();
  const site = await getSettings("site");
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
          <Toggle name="testBanner" defaultChecked={site.testBanner} label="Показывать плашку «Тестовые данные», пока в базе есть тестовые события" />
        </SettingsForm>
      </Section>
    </>
  );
}
