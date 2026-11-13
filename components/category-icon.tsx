import { BookOpen, Drama, Film, Landmark, Map, Music, Palette, PartyPopper, Smile, Sparkles, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  theatre: Drama,
  concert: Music,
  exhibition: Palette,
  museum: Landmark,
  kids: Smile,
  cinema: Film,
  festival: PartyPopper,
  lecture: BookOpen,
  excursion: Map,
};

export function CategoryIcon({ slug, className }: { slug?: string | null; className?: string }) {
  const Icon = (slug && ICONS[slug]) || Sparkles;
  return <Icon className={className} aria-hidden />;
}
