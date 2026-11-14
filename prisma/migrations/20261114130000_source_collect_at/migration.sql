-- Время ежедневного сбора источника (ЧЧ:ММ по Уфе); пусто — по интервалу intervalHours
ALTER TABLE "Source" ADD COLUMN "collectAt" TEXT;
