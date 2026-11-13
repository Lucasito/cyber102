import { PageTitle, Section } from "@/components/admin/blocks";
import { Field, SecretInput, Select, SettingsForm } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { getSettings, maskSecret } from "@/lib/server/settings";
import { saveMap } from "../../actions";

export default async function AdminMap() {
  await requireAdmin();
  const map = await getSettings("map");
  return (
    <>
      <PageTitle title="Карта" desc="Вид «На карте» в каталоге и «Как добраться» на странице события." />
      <Section>
        <SettingsForm action={saveMap}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Карта">
              <Select name="provider" defaultValue={map.provider}>
                <option value="osm">OpenStreetMap (бесплатно, без ключа)</option>
                <option value="yandex">Яндекс Карты (нужен ключ)</option>
              </Select>
            </Field>
            <Field label="Ключ JavaScript API Яндекс Карт" hint="developer.tech.yandex.ru. Ключ виден в браузере — ограничьте его адресом сайта (HTTP Referer).">
              <SecretInput name="yandexKey" masked={maskSecret(map.yandexKey)} />
            </Field>
          </div>
          <p className="text-xs text-stone-500">
            Сейчас на сайте: {map.provider === "yandex" && map.yandexKey ? "Яндекс Карты" : "OpenStreetMap"}. Если ключ Яндекса не подойдёт, сайт сам покажет OpenStreetMap.
          </p>
        </SettingsForm>
      </Section>
    </>
  );
}
