-- Трассы: идентификатор пользователя хранится только хешем. Стираем сырые IP и id мессенджеров, записанные раньше.
UPDATE "QueryLog" SET "userKey" = NULL WHERE "userKey" IS NOT NULL AND "userKey" !~ '^[a-z]+:[0-9a-f]{16}$';
