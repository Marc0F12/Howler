import type { ChampionshipDto, ChampionshipEntryDto, ChampionshipRoundDto, ChampionshipTeamDto, ScheduleItem, ScheduleKind } from '@howler/shared';

/** Participantes agrupados por equipo (en el orden de los equipos); los sin equipo van al final. Sin equipos: un solo grupo sin cabecera. */
export interface RosterGroup { team: ChampionshipTeamDto | null; entries: ChampionshipEntryDto[] }

export function groupRoster(c: Pick<ChampionshipDto, 'teams' | 'entries'>): RosterGroup[] {
  if (c.teams.length === 0) return c.entries.length ? [{ team: null, entries: [...c.entries] }] : [];
  const groups: RosterGroup[] = c.teams.map((team) => ({ team, entries: c.entries.filter((e) => e.teamId === team.id) }));
  const loose = c.entries.filter((e) => e.teamId == null || !c.teams.some((t) => t.id === e.teamId));
  return [...groups.filter((g) => g.entries.length > 0), ...(loose.length ? [{ team: null, entries: loose }] : [])];
}

export type SessionKind = ScheduleKind;
export type TimelineItem = ScheduleItem;

/** Las citas de una prueba en orden: las que trae su calendario completo o, si no, práctica, clasificación y carrera según sus fechas. */
export function timeline(r: Pick<ChampionshipRoundDto, 'practiceAt' | 'qualiAt' | 'raceAt'> & { schedule?: ScheduleItem[] | null }): TimelineItem[] {
  if (r.schedule && r.schedule.length > 0) return r.schedule;
  const base: TimelineItem[] = [
    { kind: 'practice', at: r.practiceAt }, { kind: 'quali', at: r.qualiAt }, { kind: 'race', at: r.raceAt },
  ];
  return base.filter((i) => i.at);
}

/** Cómo encaja la imagen del campeonato en su marco cuadrado: una foto llena el marco (`cover`); una insignia o copa con transparencia se ve entera (`contain`). El servidor ya deduce el ajuste «automático» mirando la imagen; sin dato (enlace externo) se llena el marco. */
export type ImageFit = 'cover' | 'contain';
export function imageFit(c: { imageUrl: string | null; imageFit?: ImageFit | null }): ImageFit {
  if (c.imageFit === 'cover' || c.imageFit === 'contain') return c.imageFit;
  return 'cover';
}

/** Primera carrera que enseñar al entrar: la próxima; si no hay, la última disputada; si no, la primera. */
export function initialRound(c: Pick<ChampionshipDto, 'roundList' | 'next'>): number {
  const byNext = c.next ? c.roundList.findIndex((r) => r.number === c.next!.number) : -1;
  if (byNext >= 0) return byNext;
  const lastPlayed = [...c.roundList].map((r, i) => ({ r, i })).filter((x) => x.r.played).at(-1);
  return lastPlayed ? lastPlayed.i : 0;
}

/** Enlaces http(s) únicos de una lista de mods (para «abrir todas las descargas»). */
export function downloadUrls(mods: { url: string }[]): string[] {
  return [...new Set(mods.map((m) => m.url).filter((u) => /^https?:\/\//i.test(u)))];
}

const ISO: Record<string, string> = {
  spain: 'ES', españa: 'ES', italy: 'IT', italia: 'IT', germany: 'DE', alemania: 'DE', france: 'FR', francia: 'FR', 'united kingdom': 'GB', uk: 'GB', england: 'GB', 'great britain': 'GB', 'reino unido': 'GB',
  portugal: 'PT', belgium: 'BE', netherlands: 'NL', holland: 'NL', austria: 'AT', switzerland: 'CH', sweden: 'SE', norway: 'NO', finland: 'FI', denmark: 'DK', poland: 'PL', 'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU',
  russia: 'RU', turkey: 'TR', japan: 'JP', japón: 'JP', china: 'CN', 'south korea': 'KR', korea: 'KR', india: 'IN', thailand: 'TH', malaysia: 'MY', singapore: 'SG', indonesia: 'ID', australia: 'AU', 'new zealand': 'NZ',
  usa: 'US', 'united states': 'US', 'united states of america': 'US', 'estados unidos': 'US', canada: 'CA', mexico: 'MX', méxico: 'MX', brazil: 'BR', brasil: 'BR', argentina: 'AR', chile: 'CL', colombia: 'CO',
  uae: 'AE', 'united arab emirates': 'AE', qatar: 'QA', bahrain: 'BH', 'saudi arabia': 'SA', 'south africa': 'ZA', morocco: 'MA', ireland: 'IE', scotland: 'GB', wales: 'GB', greece: 'GR', slovakia: 'SK', slovenia: 'SI', croatia: 'HR', romania: 'RO', ukraine: 'UA',
};

/** Iniciales de país (ISO) a partir del nombre en inglés o español que trae AC; sin coincidencia, sus dos primeras letras; vacío si no hay país. */
export function countryCode(country: string | null | undefined): string {
  const k = (country ?? '').trim().toLowerCase();
  if (!k) return '';
  return ISO[k] ?? (/^[a-z]{2}$/.test(k) ? k.toUpperCase() : k.replace(/[^a-záéíóúñ]/g, '').slice(0, 2).toUpperCase());
}

/** Posición dentro de una lista circular (acepta negativos y valores mayores que el tamaño). */
export const wrapIndex = (i: number, n: number): number => (n <= 0 ? 0 : ((i % n) + n) % n);

/** Pasos (con signo) para girar de la posición `from` a la `to` por el camino más corto de una rueda de `n`; en un empate, hacia delante. */
export function shortestDelta(from: number, to: number, n: number): number {
  if (n <= 1) return 0;
  const d = wrapIndex(to - from, n);
  return d <= n / 2 ? d : d - n;
}

/** Número de un texto de ficha como «210 cv», «1.200 kg» o «1,200 kg» (el punto o la coma seguidos de 3 cifras son de miles). */
export function specNumber(text: string | undefined): number | null {
  const m = /(\d[\d.,\s]*)/.exec(text ?? '');
  if (!m) return null;
  const raw = m[1]!.replace(/\s/g, '').replace(/[.,]+$/, '');
  const n = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Caballos por tonelada a partir de las especificaciones de la ficha (claves en español o inglés); null si falta la potencia o el peso. */
export function powerToWeight(specs: Record<string, string>): number | null {
  const find = (re: RegExp) => Object.entries(specs).find(([k]) => re.test(k.toLowerCase()))?.[1];
  const hp = specNumber(find(/potencia|power|^bhp|^hp/)), kg = specNumber(find(/peso|weight|mass/));
  return hp != null && kg != null && kg > 100 ? Math.round((hp / kg) * 1000) : null;
}
