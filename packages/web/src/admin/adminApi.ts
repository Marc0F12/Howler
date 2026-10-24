import type { SmartKey, SmartMode, SmartSettingDto, SoundsDto, UpdateStateDto, ManagedDriverDto, MhStateDto, InstalledContentDto, DiscordEventId, DiscordEventSetting, PenaltyDto, PenaltyInput, PenaltySessionDto, RacePenaltyRules, ImportReportDto, StrackerApplyInput, StrackerPreviewDto, ChampionshipDto, ChampionshipInput, ChampionshipStatus, ChampionshipSummaryDto, SessionCandidateDto, AdminLapDto, AdminStateDto, CommandResultDto, LapRulesConfig, LapRulesStateDto, RevalidationDto, ServerDirCheckDto, SessionSettingsDto, WeatherEntryDto, CarChecksumsStateDto, ServerDiagnosisDto, EntryListDto, EntrySlotDto, WeatherStateDto, ServerSheetDto, SheetPresetsDto, SessionPanelDto, SessionsPlan, SettingValue, ScheduleStateDto, ScheduledEventInput, AccountsStateDto, AccountRole, WhoAmIDto, CarTyresDto, SignupStateDto, SignupSettings } from '@howler/shared';

export interface SessionPresetsDto { presets: { id: string; name: string; values: Record<string, SettingValue>; sessions: SessionsPlan }[] }
export interface SetupsDto { server: { file: string; car: string | null; bytes: number }[]; user: { car: string; track: string; file: string }[] }

/** Cabecera que exige el panel en toda orden: una web ajena no puede ponerla sin permiso del navegador. */
const HEADERS = { 'Content-Type': 'application/json', 'X-Howler-Admin': '1' };

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no era JSON */ }
  // Sesión caducada o cerrada (acceso remoto): el panel vuelve a pedir usuario y contraseña.
  if (r.status === 401) window.dispatchEvent(new Event('howler-auth'));
  if (!r.ok) {
    const j = json as { error?: string; reply?: string } | null;
    throw new Error(j?.error ?? j?.reply ?? `Error ${r.status}`);
  }
  return json as T;
}

export interface RecordAnnounceDto { session: boolean; combo: boolean; global: boolean; messages: { session: string; combo: string; global: string } }
export interface DiscordHookDto { id: string; name: string; hint: string }
export interface DiscordStateDto { configured: boolean; hint: string; hooks: DiscordHookDto[]; serverName: string; publicUrl: string; events: Partial<Record<DiscordEventId, DiscordEventSetting>> }

export const adminGet = <T>(url: string) => fetch(url, { headers: { 'X-Howler-Admin': '1' } }).then((r) => parse<T>(r));
export const adminPost = <T = { ok: boolean }>(url: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).then((r) => parse<T>(r));

/** ¿Estoy abriendo la web desde el panel (127.0.0.1) o desde la web pública? */
export const detectAdmin = () => whoAmI().then((w) => !!w && (w.admin || w.login));

/** Quién soy para el panel: el propio PC (sin contraseña) o una cuenta con sesión; `login` = hay que iniciar sesión. */
export const whoAmI = (): Promise<WhoAmIDto | null> =>
  fetch('/admin/api/ping')
    .then((r) => (r.ok ? (r.json() as Promise<WhoAmIDto>) : null))
    .catch(() => null);

/** DELETE con cuerpo `{}`: Fastify rechaza un cuerpo JSON vacío. */
export const adminDelete = <T = { ok: boolean }>(url: string) => fetch(url, { method: 'DELETE', headers: HEADERS, body: '{}' }).then((r) => parse<T>(r));
export const adminPut = <T = { ok: boolean }>(url: string, body: unknown) => fetch(url, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) }).then((r) => parse<T>(r));

/** Ficha de un mod leída de su página web (lo que se pudo). */
export interface ModInfoDto { url: string; title: string | null; description: string | null; imageUrl: string | null; siteName: string | null; kind: 'car' | 'track' | 'other'; specs: Record<string, string> }

/** Sube una imagen de portada (el archivo tal cual, como cuerpo binario) y devuelve su ruta pública. */
export const uploadChampionshipImage = (file: File) =>
  fetch('/admin/api/championship-image', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Howler-Admin': '1' }, body: file }).then((r) => parse<{ imageUrl: string; hasAlpha?: boolean }>(r));

/** Sube el .db3 de stracker (el archivo tal cual) y devuelve el resumen para decidir qué importar. */
export const uploadStracker = (file: File) =>
  fetch('/admin/api/import/stracker/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Howler-Admin': '1' }, body: file }).then((r) => parse<StrackerPreviewDto>(r));

export const adminApi = {
  // Penalizaciones
  penaltySessions: () => adminGet<PenaltySessionDto[]>('/admin/api/penalties/sessions'),
  penalties: (sessionId?: number) => adminGet<PenaltyDto[]>(`/admin/api/penalties${sessionId ? `?sessionId=${sessionId}` : '?limit=30'}`),
  addPenalty: (p: PenaltyInput) => adminPost<{ id: number }>('/admin/api/penalties', p),
  removePenalty: (id: number) => adminDelete(`/admin/api/penalties/${id}`),
  recordAnnounce: () => adminGet<RecordAnnounceDto>('/admin/api/record-announce'),
  saveRecordAnnounce: (b: RecordAnnounceDto) => adminPost<RecordAnnounceDto>('/admin/api/record-announce', b),
  discord: () => adminGet<DiscordStateDto>('/admin/api/discord'),
  saveDiscord: (b: { webhookUrl?: string; publicUrl?: string; serverName?: string; events?: Partial<Record<DiscordEventId, DiscordEventSetting>> }) => adminPost<DiscordStateDto>('/admin/api/discord', b),
  multihowler: () => adminGet<MhStateDto>('/admin/api/multihowler'),
  mhIdentity: (b: { name?: string; address?: string; badge?: string; badgeBg?: string; badgeFg?: string }) => adminPut<MhStateDto>('/admin/api/multihowler/identity', b),
  mhRegenerateKey: () => adminPost<MhStateDto>('/admin/api/multihowler/key/regenerate'),
  mhRegenerateIdentity: () => adminPost<MhStateDto>('/admin/api/multihowler/identity/regenerate', { confirm: true }),
  mhLink: (b: { url: string; key: string; give: boolean; receive: boolean }) => adminPost<MhStateDto>('/admin/api/multihowler/link', b),
  mhApprove: (id: number, give: boolean, receive: boolean) => adminPost<MhStateDto>(`/admin/api/multihowler/peers/${id}/approve`, { give, receive }),
  mhDeny: (id: number) => adminPost<MhStateDto>(`/admin/api/multihowler/peers/${id}/deny`),
  mhRevoke: (id: number) => adminPost<MhStateDto>(`/admin/api/multihowler/peers/${id}/revoke`),
  mhSync: (id: number) => adminPost<MhStateDto>(`/admin/api/multihowler/peers/${id}/sync`),
  mhUpdate: (id: number, b: { give?: boolean; receive?: boolean; shareChampionships?: boolean; shareTraces?: boolean; hidden?: boolean }) => adminPut<MhStateDto>(`/admin/api/multihowler/peers/${id}`, b),
  mhRemove: (id: number) => adminDelete<MhStateDto>(`/admin/api/multihowler/peers/${id}`),
  managedDrivers: () => adminGet<ManagedDriverDto[]>('/admin/api/drivers'),
  updateDriver: (id: number, b: { name?: string; hidden?: boolean }) => adminPut<ManagedDriverDto[]>(`/admin/api/drivers/${id}`, b),
  mergeDriver: (id: number, intoId: number) => adminPost<ManagedDriverDto[]>(`/admin/api/drivers/${id}/merge`, { intoId }),
  mhDeleteData: (id: number) => adminDelete<MhStateDto & { deleted: number }>(`/admin/api/multihowler/peers/${id}/data`),
  update: () => adminGet<UpdateStateDto>('/admin/api/update'),
  checkUpdate: () => adminPost<UpdateStateDto>('/admin/api/update/check'),
  dismissUpdate: (version: string) => adminPost<UpdateStateDto>('/admin/api/update/dismiss', { version }),
  updateSettings: (b: { check?: boolean; channel?: 'stable' | 'beta' }) => adminPut<UpdateStateDto>('/admin/api/update/settings', b),
  applyUpdate: () => adminPost<UpdateStateDto>('/admin/api/update/apply'),
  addDiscordHook: (name: string, url: string) => adminPost<DiscordStateDto>('/admin/api/discord/webhooks', { name, url }),
  removeDiscordHook: (id: string) => adminDelete<DiscordStateDto>(`/admin/api/discord/webhooks/${id}`),
  testDiscord: (webhookUrl?: string, event?: { id: DiscordEventId; title: string; message: string }) => adminPost('/admin/api/discord/test', { webhookUrl, ...(event ? { event: event.id, title: event.title, message: event.message } : {}) }),
  racePenalties: () => adminGet<RacePenaltyRules>('/admin/api/race-penalties'),
  saveRacePenalties: (r: RacePenaltyRules) => adminPost<RacePenaltyRules>('/admin/api/race-penalties', r),
  /** Lanza la importación en segundo plano; devuelve el identificador para consultar el avance. */
  startStrackerImport: (input: StrackerApplyInput) => adminPost<{ jobId: string }>('/admin/api/import/stracker/apply', input),
  strackerImportStatus: (jobId: string) => adminGet<{ state: 'running' | 'done' | 'error'; done: number; total: number; report: ImportReportDto | null; error: string | null }>(`/admin/api/import/stracker/jobs/${jobId}`),
  importedDrivers: () => adminGet<{ imported: { id: number; name: string; laps: number }[]; drivers: { id: number; name: string }[] }>('/admin/api/import/drivers'),
  mergeDrivers: (fromId: number, intoId: number) => adminPost('/admin/api/import/merge', { fromId, intoId }),
  cancelStracker: (uploadId: string) => adminDelete(`/admin/api/import/stracker/${uploadId}`),
  // Campeonatos
  championships: () => adminGet<ChampionshipSummaryDto[]>('/admin/api/championships'),
  championship: (id: number) => adminGet<ChampionshipDto>(`/admin/api/championships/${id}`),
  createChampionship: (input: ChampionshipInput) => adminPost<{ id: number }>('/admin/api/championships', input),
  updateChampionship: (id: number, input: ChampionshipInput) => adminPut<{ id: number }>(`/admin/api/championships/${id}`, input),
  deleteChampionship: (id: number) => adminDelete(`/admin/api/championships/${id}`),
  setChampionshipStatus: (id: number, status: ChampionshipStatus) => adminPost(`/admin/api/championships/${id}/status`, { status }),
  championshipCandidates: (id: number) => adminGet<SessionCandidateDto[]>(`/admin/api/championships/${id}/candidates`),
  assignSession: (id: number, roundId: number, kind: 'race' | 'quali', sessionId: number | null) => adminPost(`/admin/api/championships/${id}/assign`, { roundId, kind, sessionId }),
  addAdjustment: (id: number, a: { roundId: number; driverId: number; points: number; reason: string }) => adminPost<{ id: number }>(`/admin/api/championships/${id}/adjustments`, a),
  removeAdjustment: (id: number, adjId: number) => adminDelete(`/admin/api/championships/${id}/adjustments/${adjId}`),
  steamResolve: (link: string) => adminPost<{ id: number; name: string }>('/admin/api/steam-resolve', { link }),
  entryList: () => adminGet<EntryListDto>('/admin/api/entry-list'),
  saveEntryList: (slots: EntrySlotDto[], applyAndRestart = false) => adminPut<EntryListDto & { restarting: boolean }>('/admin/api/entry-list', { slots, applyAndRestart }),
  saveServerTrack: (track: string, layout: string) => adminPut<EntryListDto & { restarting: boolean }>('/admin/api/server-track', { track, layout, applyAndRestart: false }),
  signups: (id: number) => adminGet<SignupStateDto>('/admin/api/championships/' + id + '/signups'),
  saveSignupSettings: (id: number, s: SignupSettings) => adminPut<SignupStateDto>('/admin/api/championships/' + id + '/signup', s),
  approveSignup: (id: number, sid: number, teamId: number | null, car: string | null) => adminPost<SignupStateDto>('/admin/api/championships/' + id + '/signups/' + sid + '/approve', { teamId, car }),
  rejectSignup: (id: number, sid: number) => adminPost<SignupStateDto>('/admin/api/championships/' + id + '/signups/' + sid + '/reject', {}),
  removeSignup: (id: number, sid: number) => adminDelete<SignupStateDto>('/admin/api/championships/' + id + '/signups/' + sid),
  carTyres: () => adminGet<CarTyresDto>('/admin/api/tyres'),
  carSkins: (model: string) => adminGet<{ id: string; name: string }[]>(`/admin/api/content/cars/${encodeURIComponent(model)}/skins`),
  sounds: () => adminGet<SoundsDto>('/admin/api/sounds'),
  selectSound: (record: string) => adminPut<SoundsDto>('/admin/api/sounds/select', { record }),
  setVolumeStyle: (style: string) => adminPut<SoundsDto>('/admin/api/sounds/volume-style', { style }),
  uploadSound: (file: File, mime: string, name: string, seconds: number) =>
    fetch(`/admin/api/sounds?name=${encodeURIComponent(name)}&seconds=${seconds.toFixed(2)}`, { method: 'POST', headers: { 'Content-Type': mime, 'X-Howler-Admin': '1' }, body: file }).then((r) => parse<SoundsDto>(r)),
  deleteSound: (id: string) => adminDelete<SoundsDto>(`/admin/api/sounds/${id}`),
  installedContent: () => adminGet<InstalledContentDto>('/admin/api/content/installed'),
  modInfo: (url: string) => adminPost<ModInfoDto>('/admin/api/mod-info', { url }),

  state: () => adminGet<AdminStateDto>('/admin/api/state'),
  detect: () => adminGet<{ dir: string; check: ServerDirCheckDto }[]>('/admin/api/detect'),
  check: (dir: string) => adminGet<ServerDirCheckDto>(`/admin/api/check?${new URLSearchParams({ dir })}`),
  openWeb: () => adminPost<{ ok: boolean; url: string }>('/admin/api/open-web'),
  saveSettings: (patch: unknown) => adminPost<{ ok: boolean; restartRequired: string[] }>('/admin/api/settings', patch),
  start: () => adminPost('/admin/api/server/start'),
  stop: () => adminPost('/admin/api/server/stop'),
  restart: () => adminPost('/admin/api/server/restart'),
  connectToServer: () => adminPost('/admin/api/server/connect'),
  serverPassword: () => adminGet<{ password: string; hasPassword: boolean }>('/admin/api/server-password'),
  saveServerPassword: (password: string, applyAndRestart = false) =>
    adminPost<{ ok: boolean; password: string; hasPassword: boolean; restarting: boolean }>('/admin/api/server-password', { password, applyAndRestart }),
  sessionPresets: () => adminGet<SessionPresetsDto>('/admin/api/session-presets'),
  saveSessionPreset: (b: { name: string; values: Record<string, SettingValue>; sessions: SessionsPlan }) => adminPost<SessionPresetsDto>('/admin/api/session-presets', b),
  deleteSessionPreset: (id: string) => adminDelete<SessionPresetsDto>(`/admin/api/session-presets/${encodeURIComponent(id)}`),
  login: (name: string, password: string) => adminPost<{ ok: boolean; name: string; role: AccountRole }>('/admin/api/login', { name, password }),
  logout: () => adminPost('/admin/api/logout'),
  accounts: () => adminGet<AccountsStateDto>('/admin/api/accounts'),
  addAccount: (b: { name: string; password: string; role: AccountRole }) => adminPost<AccountsStateDto>('/admin/api/accounts', b),
  updateAccount: (id: string, b: { name?: string; password?: string; role?: AccountRole }) => adminPut<AccountsStateDto>(`/admin/api/accounts/${encodeURIComponent(id)}`, b),
  deleteAccount: (id: string) => adminDelete<AccountsStateDto>(`/admin/api/accounts/${encodeURIComponent(id)}`),
  setRemoteAccess: (enabled: boolean) => adminPost<AccountsStateDto & { restartRequired: boolean }>('/admin/api/accounts/remote', { enabled }),
  schedule: () => adminGet<ScheduleStateDto>('/admin/api/schedule'),
  addSchedule: (b: ScheduledEventInput) => adminPost<ScheduleStateDto>('/admin/api/schedule', b),
  updateSchedule: (id: string, b: ScheduledEventInput) => adminPut<ScheduleStateDto>(`/admin/api/schedule/${encodeURIComponent(id)}`, b),
  deleteSchedule: (id: string) => adminDelete<ScheduleStateDto>(`/admin/api/schedule/${encodeURIComponent(id)}`),
  runSchedule: (id: string) => adminPost<ScheduleStateDto>(`/admin/api/schedule/${encodeURIComponent(id)}/run`),
  setups: () => adminGet<SetupsDto>('/admin/api/setups'),
  importSetup: (b: { car: string; track: string; file: string }) => adminPost<{ ok: boolean; name: string }>('/admin/api/setups/import', b),
  sessionPanel: () => adminGet<SessionPanelDto>('/admin/api/session-panel'),
  saveSessionPanel: (b: { values?: Record<string, SettingValue>; sessions?: SessionsPlan; applyAndRestart?: boolean }) =>
    adminPost<{ ok: boolean; panel: SessionPanelDto; restarting: boolean }>('/admin/api/session-panel', b),
  sessionSettings: () => adminGet<SessionSettingsDto>('/admin/api/session-settings'),
  saveSessionSettings: (s: Partial<SessionSettingsDto> & { applyAndRestart?: boolean }) =>
    adminPost<{ ok: boolean; settings: SessionSettingsDto; restarting: boolean }>('/admin/api/session-settings', s),
  setWeatherMode: (fx: boolean, applyAndRestart: boolean) => adminPost<{ ok: boolean; fx: boolean; restarting: boolean }>('/admin/api/weather/mode', { fx, applyAndRestart }),
  serverDiagnosis: () => adminGet<ServerDiagnosisDto[]>('/admin/api/server/diagnosis'),
  serverFix: (fix: 'allow-track-params' | 'allow-car-checksums') => adminPost<{ ok: true; changed: boolean }>('/admin/api/server/fix', { fix }),
  carChecksums: () => adminGet<CarChecksumsStateDto>('/admin/api/car-checksums'),
  allowMissingChecksums: (on: boolean) => adminPost<{ ok: true; changed: boolean }>('/admin/api/car-checksums/allow', { on }),
  setCarChecksums: (models: string[], skip: boolean, applyAndRestart = false) => adminPost<{ ok: boolean; changed: string[]; refused: { model: string; reason: string }[]; restarting: boolean }>('/admin/api/car-checksums', { models, skip, applyAndRestart }),
  serverSheet: () => adminGet<ServerSheetDto>('/admin/api/server-sheet'),
  saveServerSheet: (title: string, description: string, applyAndRestart = false) => adminPut<ServerSheetDto & { restarting: boolean }>('/admin/api/server-sheet', { title, description, applyAndRestart }),
  sheetPresets: () => adminGet<SheetPresetsDto>('/admin/api/sheet-presets'),
  saveSheetPreset: (name: string, description: string) => adminPost<SheetPresetsDto>('/admin/api/sheet-presets', { name, description }),
  deleteSheetPreset: (id: string) => fetch(`/admin/api/sheet-presets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Howler-Admin': '1' }, body: '{}' }).then((r) => parse<SheetPresetsDto>(r)),
  setDefaultSheetPreset: (id: string | null) => adminPut<SheetPresetsDto>('/admin/api/sheet-presets/default', { id }),
  smartSettings: () => adminGet<{ settings: SmartSettingDto[] }>('/admin/api/smart-settings'),
  setSmartSetting: (key: SmartKey, mode: SmartMode, applyAndRestart = false) => adminPost<{ ok: boolean; changed: SmartKey[]; settings: SmartSettingDto[]; restarting: boolean }>('/admin/api/smart-settings', { key, mode, applyAndRestart }),
  weather: () => adminGet<WeatherStateDto>('/admin/api/weather'),
  saveWeatherList: (graphics: string[], applyAndRestart = false) =>
    adminPost<{ ok: boolean; list: WeatherEntryDto[]; restarting: boolean }>('/admin/api/weather/list', { graphics, applyAndRestart }),
  // Reglas de vuelta válida
  lapRules: () => adminGet<LapRulesStateDto>('/admin/api/lap-rules'),
  saveLapRules: (config: LapRulesConfig) => adminPost<{ ok: boolean } & LapRulesStateDto>('/admin/api/lap-rules', config),
  previewLapRules: (config?: LapRulesConfig) => adminPost<RevalidationDto>('/admin/api/lap-rules/preview', { config }),
  applyLapRules: () => adminPost<RevalidationDto>('/admin/api/lap-rules/apply'),
  laps: (limit = 40, pending = false) => adminGet<AdminLapDto[]>(`/admin/api/laps?limit=${limit}${pending ? '&pending=1' : ''}`),
  lapAction: (id: number, action: 'void' | 'valid' | 'reset', note?: string) => adminPost<{ ok: boolean; valid: boolean; reason: string | null }>(`/admin/api/laps/${id}/${action}`, { note }),
  currentTime: () => adminGet<{ time: string | null }>('/admin/api/control/time'),
  control: {
    weatherId: (id: number) => adminPost<CommandResultDto>('/admin/api/control/weather-id', { id }),
    time: (time: string) => adminPost<CommandResultDto>('/admin/api/control/time', { time }),
    weather: (type: string, durationSeconds: number) => adminPost<CommandResultDto>('/admin/api/control/weather', { type, durationSeconds }),
    rain: (intensity: number, wetness: number, water: number) => adminPost<CommandResultDto>('/admin/api/control/rain', { intensity, wetness, water }),
    grip: (percent: number) => adminPost<CommandResultDto>('/admin/api/control/grip', { percent }),
    say: (message: string) => adminPost<CommandResultDto>('/admin/api/control/say', { message }),
    kick: (carId: number) => adminPost<CommandResultDto>('/admin/api/control/kick', { carId }),
    ban: (carId: number) => adminPost<CommandResultDto>('/admin/api/control/ban', { carId }),
    ballast: (carId: number, kg: number) => adminPost<CommandResultDto>('/admin/api/control/ballast', { carId, kg }),
    restrictor: (carId: number, percent: number) => adminPost<CommandResultDto>('/admin/api/control/restrictor', { carId, percent }),
    session: (action: 'next' | 'restart') => adminPost<CommandResultDto>('/admin/api/control/session', { action }),
  },
};
