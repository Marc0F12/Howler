import { t } from '../i18n';
import { isChampionshipImageRef, SCORING_PRESETS, type BadgeDesign, type ChampionshipDto, type ChampionshipFormat, type ChampionshipInput, type ChampionshipModInput, type ChampionshipStatus, type ScheduleItem, type ScheduleKind, type ScoringConfig } from '@howler/shared';

/** Estado del asistente de campeonatos. Las fechas van como las da `<input type="datetime-local">` (hora local, sin zona). */
export interface DraftTeam { key: string; name: string; color: string }
export interface DraftEntry { driverId: number; name: string; teamKey: string | null; /** Coche y skin asignados (vacío = sin asignar). */ car: string; skin: string }
export interface DraftMod { name: string; kind: ChampionshipModInput['kind']; url: string; note: string; imageUrl: string; specs: Record<string, string> }
/** Una cita del fin de semana. `at` va como `datetime-local`. */
export interface DraftSession { kind: ScheduleKind; title: string; at: string; duration: string; text: string }
export interface DraftRound { id?: number; track: string; layout: string; cars: string[]; /** Clima de la carrera (vacío = sin decir: sol con nubes). */ weather: string; schedule: DraftSession[]; mods: DraftMod[] }
export interface Draft {
  id?: number;
  name: string; description: string; imageUrl: string; /** Ajuste de la imagen en su marco: vacío = automático. */ imageFit: '' | 'cover' | 'contain'; /** Diseño de la insignia creada en el panel (la imagen es su PNG); null si la imagen es otra. */ badgeDesign: BadgeDesign | null;
  format: ChampionshipFormat; status: ChampionshipStatus;
  scoring: ScoringConfig;
  teams: DraftTeam[]; entries: DraftEntry[]; rounds: DraftRound[]; mods: DraftMod[];
}

export const TEAM_COLORS = ['#ef4b4b', '#4b9bef', '#5fd16a', '#f0a030', '#b45cff', '#2dd4bf', '#f472b6', '#a3a3a3'];

export const emptyMod = (kind: DraftMod['kind'] = 'car'): DraftMod => ({ name: '', kind, url: '', note: '', imageUrl: '', specs: {} });
export const emptySession = (kind: ScheduleKind = 'race'): DraftSession => ({ kind, title: '', at: '', duration: '', text: '' });
export const emptyRound = (): DraftRound => ({ track: '', layout: '', cars: [], weather: '', schedule: [emptySession('quali'), emptySession('race')], mods: [] });
export const newDraft = (): Draft => ({
  name: '', description: '', imageUrl: '', imageFit: '', badgeDesign: null, format: 'individual', status: 'draft',
  scoring: structuredClone(SCORING_PRESETS.f1!.config), teams: [], entries: [], rounds: [emptyRound()], mods: [],
});

/** Clave nueva para un equipo (única dentro del borrador). */
export function nextTeamKey(teams: DraftTeam[]): string {
  let n = teams.length + 1;
  while (teams.some((t) => t.key === `t${n}`)) n++;
  return `t${n}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO (UTC) → valor de datetime-local en la hora del navegador. */
export const isoToLocal = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Valor de datetime-local → ISO (UTC); vacío = sin fecha. */
export const localToIso = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const modToInput = (m: DraftMod): ChampionshipModInput => ({
  name: m.name.trim(), kind: m.kind, url: m.url.trim(), note: m.note.trim() || null, imageUrl: m.imageUrl.trim() || null, specs: m.specs,
});
const modFromDto = (m: ChampionshipDto['mods'][number]): DraftMod => ({ name: m.name, kind: m.kind, url: m.url, note: m.note ?? '', imageUrl: m.imageUrl ?? '', specs: m.specs });

/** Las citas que dicen algo (hora, duración o texto; las «otras» además necesitan título), en el orden en que están. */
export function scheduleToInput(list: DraftSession[]): ScheduleItem[] {
  return list
    .filter((s) => s.at || s.duration.trim() || s.text.trim() || (s.kind === 'custom' && s.title.trim()))
    .map((s) => ({ kind: s.kind, at: localToIso(s.at), ...(s.title.trim() ? { title: s.title.trim() } : {}), ...(s.duration.trim() ? { duration: s.duration.trim() } : {}), ...(s.text.trim() ? { text: s.text.trim() } : {}) }));
}
const scheduleFromDto = (r: ChampionshipDto['roundList'][number]): DraftSession[] => {
  const items: ScheduleItem[] = r.schedule ?? ([['practice', r.practiceAt], ['quali', r.qualiAt], ['race', r.raceAt]] as const).filter(([, at]) => at).map(([kind, at]) => ({ kind, at }));
  return items.length > 0 ? items.map((i) => ({ kind: i.kind, title: i.title ?? '', at: isoToLocal(i.at), duration: i.duration ?? '', text: i.text ?? '' })) : [emptySession('race')];
};

export function toInput(d: Draft): ChampionshipInput {
  return {
    name: d.name.trim(), description: d.description.trim(), imageUrl: d.imageUrl.trim() || null, imageFit: d.imageUrl.trim() && d.imageFit ? d.imageFit : null, badgeDesign: d.imageUrl.trim() ? d.badgeDesign : null, format: d.format, status: d.status, scoring: d.scoring,
    teams: d.format === 'individual' ? [] : d.teams.map((t) => ({ key: t.key, name: t.name.trim(), color: t.color })),
    entries: d.entries.map((e) => ({ driverId: e.driverId, teamKey: d.format === 'individual' ? null : e.teamKey, car: e.car || null, skin: e.car ? e.skin || null : null })),
    rounds: d.rounds.map((r) => ({
      ...(r.id != null ? { id: r.id } : {}),
      track: r.track.trim(), layout: r.layout.trim(), cars: r.cars,
      weather: r.weather || null, schedule: scheduleToInput(r.schedule),
      mods: r.mods.filter((m) => m.name.trim() && m.url.trim()).map(modToInput),
    })),
    mods: d.mods.filter((m) => m.name.trim() && m.url.trim()).map(modToInput),
  };
}

/** Borrador a partir de un campeonato guardado (para editarlo). */
export function fromDto(c: ChampionshipDto): Draft {
  const key = (id: number) => `t${id}`;
  return {
    id: c.id, name: c.name, description: c.description, imageUrl: c.imageUrl ?? '', imageFit: c.imageFit ?? '', badgeDesign: c.badgeDesign ?? null, format: c.format, status: c.status, scoring: structuredClone(c.scoring),
    teams: c.teams.map((t) => ({ key: key(t.id), name: t.name, color: t.color })),
    entries: c.entries.map((e) => ({ driverId: e.driverId, name: e.name, teamKey: e.teamId != null ? key(e.teamId) : null, car: e.car ?? '', skin: e.skin ?? '' })),
    rounds: c.roundList.map((r) => ({
      id: r.id, track: r.track, layout: r.layout, cars: r.cars, weather: r.weather ?? '', schedule: scheduleFromDto(r), mods: r.mods.map(modFromDto),
    })),
    mods: c.mods.map(modFromDto),
  };
}

export const STEPS = [t('Tipo'), t('Participantes'), t('Carreras'), t('Puntuación'), t('Resumen')] as const;

const validUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

/** Problemas que impiden pasar del paso `step` (0-4) o guardar. Vacío = todo bien. */
export function problems(d: Draft, step: number): string[] {
  const out: string[] = [];
  if (step === 0 && !d.name.trim()) out.push(t('Ponle un nombre al campeonato.'));
  if (step === 0 && d.imageUrl.trim() && !isChampionshipImageRef(d.imageUrl.trim())) out.push(t('La imagen debe ser un archivo subido o un enlace que empiece por http:// o https://.'));
  if (step === 1) {
    if (d.entries.length === 0) out.push(t('Añade al menos un participante.'));
    if (d.format !== 'individual') {
      if (d.teams.length === 0) out.push(d.format === 'pairs' ? t('Crea al menos una pareja.') : t('Crea al menos un equipo.'));
      if (d.teams.some((t) => !t.name.trim())) out.push(t('Todos los equipos necesitan nombre.'));
      if (d.entries.some((e) => e.teamKey == null || !d.teams.some((t) => t.key === e.teamKey))) out.push(t('Cada piloto debe estar en un equipo.'));
      if (d.format === 'pairs') for (const tm of d.teams) if (d.entries.filter((e) => e.teamKey === tm.key).length !== 2) out.push(t('La pareja «{name}» debe tener exactamente 2 pilotos.', { name: tm.name || tm.key }));
    }
  }
  if (step === 2) {
    if (d.rounds.length === 0) out.push(t('Añade al menos una carrera.'));
    d.rounds.forEach((r, i) => { if (!r.track.trim()) out.push(t('La carrera {n} necesita un circuito.', { n: i + 1 })); });
    const mods = [...d.mods, ...d.rounds.flatMap((r) => r.mods)];
    if (mods.some((m) => (m.name.trim() || m.url.trim()) && !validUrl(m.url))) out.push(t('Los enlaces de descarga de los mods deben empezar por http:// o https://.'));
    if (mods.some((m) => m.url.trim() && !m.name.trim())) out.push(t('Cada mod necesita un nombre además del enlace.'));
    if (mods.some((m) => m.imageUrl.trim() && !validUrl(m.imageUrl))) out.push(t('La imagen de un mod no es un enlace válido.'));
  }
  if (step === 3) {
    const s = d.scoring;
    if (s.mode === 'points' && s.pointsTable.length === 0) out.push(t('La tabla de puntos no puede estar vacía.'));
    if (s.mode === 'points' && s.pointsTable.some((p) => !Number.isFinite(p))) out.push(t('La tabla de puntos solo admite números.'));
  }
  return out;
}

/** Texto «1.º 25 · 2.º 18 …» para la vista previa de la tabla de puntos. */
export function pointsPreview(table: number[], max = 10): string {
  const shown = table.slice(0, max).map((p, i) => t('{n}.º {p}', { n: i + 1, p })).join(' · ');
  return table.length > max ? `${shown} …` : shown;
}

/** «25, 18, 15» → [25, 18, 15]; ignora lo que no sea número. */
export function parsePoints(text: string): number[] {
  return text.split(/[\s,;]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
}

/** Plazas que faltan en el circuito de una carrera: inscritos menos boxes, o 0 si caben o no se sabe. */
export function missingPitboxes(entries: number, pitboxes: number | null | undefined): number {
  return pitboxes == null || pitboxes <= 0 ? 0 : Math.max(0, entries - pitboxes);
}
