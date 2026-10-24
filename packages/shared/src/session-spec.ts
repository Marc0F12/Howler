/**
 * Registro ÚNICO de los ajustes de sesión que el panel puede editar (los del `server_cfg.ini` del preset y unos pocos
 * del `extra_cfg.yml` de AssettoServer). Cada ajuste dice dónde vive, su tipo, rango, valor de serie y cómo se explica.
 * El servidor lo usa para validar y escribir; la web, para dibujar el panel sin saber nada de cada clave.
 *
 * Las claves y los valores salen del código de AssettoServer pre35 y del `server_cfg.ini` que escribe Content Manager.
 * Para añadir un ajuste: una entrada aquí (y nada más; el panel lo dibuja solo).
 */

export interface Txt { es: string; en: string }

export type SettingKind = 'int' | 'float' | 'bool' | 'choice' | 'text';
/** Dónde está el ajuste: sección del `server_cfg.ini`, o `extra` = clave de primer nivel del `extra_cfg.yml`. */
export type SettingFile = 'server' | 'extra';
export type SettingGroup = 'conditions' | 'assists' | 'tyres' | 'race' | 'general' | 'votes' | 'ai' | 'network';
/** `big` = tarjeta grande y a la vista; `mid` = plegado; `adv` = «Avanzado». */
export type SettingTier = 'big' | 'mid' | 'adv';

export interface SettingSpec {
  /** Identificador estable (el que viaja por la API). */
  id: string;
  file: SettingFile;
  /** Sección del ini (`SERVER`, `DYNAMIC_TRACK`…); vacío en `extra`. `key: '#section'` = el ajuste es la propia sección (encendida o apagada). */
  section: string;
  key: string;
  kind: SettingKind;
  def: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: { value: number; label: Txt }[];
  group: SettingGroup;
  tier: SettingTier;
  label: Txt;
  help: Txt;
}

export const GROUP_META: Record<SettingGroup, { title: Txt; hint: Txt }> = {
  conditions: { title: { es: 'Condiciones', en: 'Conditions' }, hint: { es: 'Combustible, daños, desgaste y agarre del asfalto.', en: 'Fuel, damage, wear and track grip.' } },
  assists: { title: { es: 'Ayudas', en: 'Assists' }, hint: { es: 'Qué ayudas a la conducción puede usar cada jugador.', en: 'Which driving assists each player may use.' } },
  tyres: { title: { es: 'Neumáticos', en: 'Tyres' }, hint: { es: 'Mantas térmicas, ruedas fuera de pista y compuestos permitidos.', en: 'Tyre blankets, wheels off track and allowed compounds.' } },
  race: { title: { es: 'Reglas de carrera', en: 'Race rules' }, hint: { es: 'Salida, parrilla, vuelta extra y boxes.', en: 'Start, grid, extra lap and pit window.' } },
  general: { title: { es: 'General', en: 'General' }, hint: { es: 'Tiempos de espera, hora del día y comportamiento del servidor.', en: 'Wait times, time of day and server behaviour.' } },
  votes: { title: { es: 'Votaciones y administración', en: 'Votes and administration' }, hint: { es: 'Cómo se vota para expulsar o cambiar de sesión.', en: 'How votes to kick or change session work.' } },
  ai: { title: { es: 'AssettoServer', en: 'AssettoServer' }, hint: { es: 'Opciones propias de AssettoServer (extra_cfg.yml).', en: 'AssettoServer-specific options (extra_cfg.yml).' } },
  network: { title: { es: 'Red y rendimiento', en: 'Network and performance' }, hint: { es: 'Solo si sabes lo que haces.', en: 'Only if you know what you are doing.' } },
};

const ASSIST_CHOICES = [
  { value: 0, label: { es: 'Prohibida', en: 'Forbidden' } },
  { value: 1, label: { es: 'Solo si el coche la trae', en: 'Only if the car has it' } },
  { value: 2, label: { es: 'Permitida en todos', en: 'Allowed on all cars' } },
];

const s = (x: Omit<SettingSpec, 'file' | 'section'> & { section?: string; file?: SettingFile }): SettingSpec => ({ file: 'server', section: 'SERVER', ...x });
const x = (x0: Omit<SettingSpec, 'file' | 'section'>): SettingSpec => ({ file: 'extra', section: '', ...x0 });

export const SETTINGS: SettingSpec[] = [
  // ---- Condiciones ----
  s({ id: 'fuelRate', key: 'FUEL_RATE', kind: 'int', def: 100, min: 0, max: 500, step: 5, unit: '%', group: 'conditions', tier: 'big',
    label: { es: 'Consumo de combustible', en: 'Fuel consumption' }, help: { es: '100 = normal · 0 = combustible infinito.', en: '100 = normal · 0 = infinite fuel.' } }),
  s({ id: 'damageMultiplier', key: 'DAMAGE_MULTIPLIER', kind: 'int', def: 100, min: 0, max: 400, step: 5, unit: '%', group: 'conditions', tier: 'big',
    label: { es: 'Daños mecánicos', en: 'Mechanical damage' }, help: { es: '100 = completos · 0 = sin daños · más de 100 = aumentados.', en: '100 = full · 0 = none · above 100 = increased.' } }),
  s({ id: 'tyreWearRate', key: 'TYRE_WEAR_RATE', kind: 'int', def: 100, min: 0, max: 500, step: 5, unit: '%', group: 'conditions', tier: 'big',
    label: { es: 'Desgaste de neumáticos', en: 'Tyre wear' }, help: { es: '100 = normal · 0 = no se desgastan.', en: '100 = normal · 0 = no wear.' } }),
  s({ id: 'dynamicTrack', section: 'DYNAMIC_TRACK', key: '#section', kind: 'bool', def: false, group: 'conditions', tier: 'big',
    label: { es: 'Agarre dinámico del asfalto', en: 'Dynamic track grip' }, help: { es: 'La pista parte de un agarre y mejora al rodar los coches. Apagado, el agarre es siempre el máximo.', en: 'The track starts at a grip level and improves as cars run. Off, grip is always at maximum.' } }),
  s({ id: 'gripStart', section: 'DYNAMIC_TRACK', key: 'SESSION_START', kind: 'int', def: 95, min: 0, max: 100, step: 1, unit: '%', group: 'conditions', tier: 'big',
    label: { es: 'Agarre del asfalto al empezar', en: 'Track grip at start' }, help: { es: 'Cuánto agarre tiene la pista al empezar la sesión (100 = máximo, como goma puesta).', en: 'How much grip the track has when the session starts (100 = fully rubbered in).' } }),
  s({ id: 'gripRandomness', section: 'DYNAMIC_TRACK', key: 'RANDOMNESS', kind: 'int', def: 0, min: 0, max: 100, step: 1, group: 'conditions', tier: 'mid',
    label: { es: 'Variación aleatoria del agarre', en: 'Grip randomness' }, help: { es: '0 = siempre el mismo agarre inicial.', en: '0 = always the same starting grip.' } }),
  s({ id: 'gripLapGain', section: 'DYNAMIC_TRACK', key: 'LAP_GAIN', kind: 'int', def: 0, min: 0, max: 500, step: 1, unit: 'vueltas', group: 'conditions', tier: 'mid',
    label: { es: 'Vueltas para ganar un 1 % de agarre', en: 'Laps to gain 1 % grip' }, help: { es: 'La pista mejora al rodar. 0 = el agarre no cambia con las vueltas.', en: 'The track improves as cars run. 0 = grip does not change with laps.' } }),
  s({ id: 'gripTransfer', section: 'DYNAMIC_TRACK', key: 'SESSION_TRANSFER', kind: 'int', def: 100, min: 0, max: 100, step: 1, unit: '%', group: 'conditions', tier: 'mid',
    label: { es: 'Agarre que pasa a la sesión siguiente', en: 'Grip carried to the next session' }, help: { es: 'Qué parte de la goma puesta se conserva al cambiar de sesión.', en: 'How much rubber is kept when the session changes.' } }),

  // ---- Ayudas ----
  s({ id: 'abs', key: 'ABS_ALLOWED', kind: 'choice', def: 1, choices: ASSIST_CHOICES, group: 'assists', tier: 'big',
    label: { es: 'ABS', en: 'ABS' }, help: { es: 'Frenos antibloqueo.', en: 'Anti-lock brakes.' } }),
  s({ id: 'tc', key: 'TC_ALLOWED', kind: 'choice', def: 1, choices: ASSIST_CHOICES, group: 'assists', tier: 'big',
    label: { es: 'Control de tracción', en: 'Traction control' }, help: { es: 'Evita que las ruedas patinen al acelerar.', en: 'Stops the wheels spinning under power.' } }),
  s({ id: 'stability', key: 'STABILITY_ALLOWED', kind: 'bool', def: false, group: 'assists', tier: 'big',
    label: { es: 'Control de estabilidad', en: 'Stability control' }, help: { es: 'Ayuda que corrige los derrapes.', en: 'Helps correct slides.' } }),
  s({ id: 'autoclutch', key: 'AUTOCLUTCH_ALLOWED', kind: 'bool', def: false, group: 'assists', tier: 'big',
    label: { es: 'Embrague automático', en: 'Auto-clutch' }, help: { es: 'Permite usar el embrague automático.', en: 'Allows the automatic clutch.' } }),

  // ---- Neumáticos ----
  s({ id: 'blankets', key: 'TYRE_BLANKETS_ALLOWED', kind: 'bool', def: false, group: 'tyres', tier: 'big',
    label: { es: 'Mantas térmicas', en: 'Tyre blankets' }, help: { es: 'Los neumáticos salen de boxes ya calientes.', en: 'Tyres leave the pits already warm.' } }),
  s({ id: 'tyresOut', key: 'ALLOWED_TYRES_OUT', kind: 'int', def: 2, min: -1, max: 4, step: 1, unit: 'ruedas', group: 'tyres', tier: 'big',
    label: { es: 'Ruedas fuera de pista permitidas', en: 'Wheels off track allowed' }, help: { es: 'A partir de cuántas ruedas fuera cuenta como corte. -1 = sin límite (no hay cortes).', en: 'From how many wheels off it counts as a cut. -1 = no limit (no cuts).' } }),
  s({ id: 'legalTyres', key: 'LEGAL_TYRES', kind: 'text', def: '', group: 'tyres', tier: 'big',
    label: { es: 'Compuestos permitidos', en: 'Allowed compounds' }, help: { es: 'Marca los compuestos que se pueden usar (o escribe sus nombres cortos separados por «;», por ejemplo SV;S). Sin marcar = todos. Cada coche tiene los suyos.', en: 'Tick the compounds that can be used (or type their short names separated by ";", for example SV;S). None ticked = all. Each car has its own.' } }),

  // ---- Reglas de carrera ----
  s({ id: 'startRule', key: 'START_RULE', kind: 'choice', def: 0, choices: [
    { value: 0, label: { es: 'Coche bloqueado hasta la salida', en: 'Car locked until the start' } },
    { value: 1, label: { es: 'Teletransporte a boxes', en: 'Teleport to the pits' } },
    { value: 2, label: { es: 'Drive-through', en: 'Drive-through' } },
  ], group: 'race', tier: 'big', label: { es: 'Salida en falso', en: 'Jump start' }, help: { es: 'Qué pasa si alguien se mueve antes de la salida.', en: 'What happens if someone moves before the start.' } }),
  s({ id: 'gasPenaltyOff', key: 'RACE_GAS_PENALTY_DISABLED', kind: 'bool', def: false, group: 'race', tier: 'mid',
    label: { es: 'Sin penalización por acelerar antes de la salida', en: 'No penalty for early throttle' }, help: { es: 'Desactiva la penalización por pisar el acelerador en la parrilla.', en: 'Disables the penalty for pressing the throttle on the grid.' } }),
  s({ id: 'extraLap', key: 'RACE_EXTRA_LAP', kind: 'bool', def: false, group: 'race', tier: 'mid',
    label: { es: 'Vuelta extra al acabar el tiempo', en: 'Extra lap after time ends' }, help: { es: 'En carreras por tiempo, se da una vuelta más tras acabar el reloj.', en: 'In timed races, one more lap is run after the clock ends.' } }),
  s({ id: 'reverseGrid', key: 'REVERSED_GRID_RACE_POSITIONS', kind: 'int', def: 0, min: -1, max: 40, step: 1, unit: 'puestos', group: 'race', tier: 'mid',
    label: { es: 'Parrilla invertida', en: 'Reversed grid' }, help: { es: '0 = no · N = se invierten los N primeros · -1 = se invierte toda la parrilla.', en: '0 = off · N = the first N are reversed · -1 = the whole grid is reversed.' } }),
  s({ id: 'pitStart', key: 'RACE_PIT_WINDOW_START', kind: 'int', def: 0, min: 0, max: 1000, step: 1, unit: 'min', group: 'race', tier: 'mid',
    label: { es: 'Ventana de boxes: abre', en: 'Pit window: opens' }, help: { es: 'Minuto de carrera en que abre la ventana de paradas obligatorias. 0 = sin ventana.', en: 'Race minute when the mandatory-stop window opens. 0 = no window.' } }),
  s({ id: 'pitEnd', key: 'RACE_PIT_WINDOW_END', kind: 'int', def: 0, min: 0, max: 1000, step: 1, unit: 'min', group: 'race', tier: 'mid',
    label: { es: 'Ventana de boxes: cierra', en: 'Pit window: closes' }, help: { es: 'Minuto de carrera en que cierra la ventana de paradas.', en: 'Race minute when the stop window closes.' } }),
  s({ id: 'maxContacts', key: 'MAX_CONTACTS_PER_KM', kind: 'int', def: -1, min: -1, max: 255, step: 1, unit: 'por km', group: 'race', tier: 'mid',
    label: { es: 'Contactos máximos por kilómetro', en: 'Maximum contacts per km' }, help: { es: 'Límite de choques con otros coches antes de sancionar. -1 = sin límite.', en: 'Limit of contacts with other cars before a penalty. -1 = no limit.' } }),

  // ---- General ----
  s({ id: 'sunAngle', key: 'SUN_ANGLE', kind: 'float', def: 0, min: -80, max: 80, step: 1, unit: '°', group: 'general', tier: 'mid',
    label: { es: 'Ángulo del sol al empezar', en: 'Sun angle at start' }, help: { es: 'Hora del día al arrancar el servidor, como ángulo del sol (el control de hora en directo está en «En directo»).', en: 'Time of day at server start as a sun angle (live time control is in "Live").' } }),
  s({ id: 'timeMult', key: 'TIME_OF_DAY_MULT', kind: 'float', def: 1, min: 0, max: 100, step: 0.5, unit: '×', group: 'general', tier: 'mid',
    label: { es: 'Velocidad del tiempo', en: 'Time speed' }, help: { es: '1 = tiempo real · 10 = el día pasa diez veces más rápido.', en: '1 = real time · 10 = the day runs ten times faster.' } }),
  s({ id: 'qualifyWait', key: 'QUALIFY_MAX_WAIT_PERC', kind: 'int', def: 120, min: 0, max: 500, step: 5, unit: '%', group: 'general', tier: 'mid',
    label: { es: 'Espera máxima tras la clasificación', en: 'Max wait after qualifying' }, help: { es: 'Porcentaje del mejor tiempo que se espera a los que aún están dando su vuelta.', en: 'Percentage of the best time to wait for cars still on a lap.' } }),
  s({ id: 'raceOver', key: 'RACE_OVER_TIME', kind: 'int', def: 60, min: 0, max: 3600, step: 5, unit: 's', group: 'general', tier: 'mid',
    label: { es: 'Tiempo para acabar tras el ganador', en: 'Time to finish after the winner' }, help: { es: 'Segundos que tienen los demás para cruzar la meta cuando el ganador acaba.', en: 'Seconds the others have to cross the line once the winner finishes.' } }),
  s({ id: 'resultScreen', key: 'RESULT_SCREEN_TIME', kind: 'int', def: 60, min: 0, max: 3600, step: 5, unit: 's', group: 'general', tier: 'mid',
    label: { es: 'Pantalla de resultados', en: 'Results screen' }, help: { es: 'Segundos que se enseñan los resultados antes de la sesión siguiente.', en: 'Seconds the results are shown before the next session.' } }),
  s({ id: 'maxBallast', key: 'MAX_BALLAST_KG', kind: 'int', def: 0, min: 0, max: 500, step: 5, unit: 'kg', group: 'general', tier: 'mid',
    label: { es: 'Lastre máximo permitido', en: 'Maximum ballast' }, help: { es: 'Tope de lastre que se puede poner a un coche.', en: 'Upper limit of ballast that can be given to a car.' } }),
  s({ id: 'virtualMirror', key: 'FORCE_VIRTUAL_MIRROR', kind: 'bool', def: true, group: 'general', tier: 'mid',
    label: { es: 'Forzar el retrovisor virtual', en: 'Force virtual mirror' }, help: { es: 'Obliga a usar el retrovisor virtual en pantalla.', en: 'Forces the on-screen virtual mirror.' } }),
  s({ id: 'loopMode', key: 'LOOP_MODE', kind: 'bool', def: true, group: 'general', tier: 'mid',
    label: { es: 'Repetir las sesiones en bucle', en: 'Loop the sessions' }, help: { es: 'Al acabar la última sesión vuelve a empezar la primera.', en: 'When the last session ends the first one starts again.' } }),
  s({ id: 'pickup', key: 'PICKUP_MODE_ENABLED', kind: 'bool', def: true, group: 'general', tier: 'mid',
    label: { es: 'Modo «pickup»', en: 'Pickup mode' }, help: { es: 'Los jugadores pueden entrar en cualquier momento, también con la carrera empezada.', en: 'Players may join at any time, even with the race under way.' } }),

  // ---- Votaciones ----
  s({ id: 'kickQuorum', key: 'KICK_QUORUM', kind: 'int', def: 80, min: 0, max: 100, step: 1, unit: '%', group: 'votes', tier: 'mid',
    label: { es: 'Votos para expulsar', en: 'Votes needed to kick' }, help: { es: 'Porcentaje de jugadores que tiene que votar a favor.', en: 'Percentage of players who must vote in favour.' } }),
  s({ id: 'voteQuorum', key: 'VOTING_QUORUM', kind: 'int', def: 70, min: 0, max: 100, step: 1, unit: '%', group: 'votes', tier: 'mid',
    label: { es: 'Votos para cambiar de sesión', en: 'Votes needed to change session' }, help: { es: 'Porcentaje de jugadores que tiene que votar a favor.', en: 'Percentage of players who must vote in favour.' } }),
  s({ id: 'voteDuration', key: 'VOTE_DURATION', kind: 'int', def: 20, min: 1, max: 300, step: 1, unit: 's', group: 'votes', tier: 'mid',
    label: { es: 'Duración de la votación', en: 'Vote duration' }, help: { es: 'Segundos que dura cada votación.', en: 'Seconds each vote lasts.' } }),

  // ---- AssettoServer (extra_cfg.yml) ----
  x({ id: 'carReset', key: 'EnableCarReset', kind: 'bool', def: false, group: 'ai', tier: 'mid',
    label: { es: 'Permitir recolocar el coche', en: 'Allow car reset' }, help: { es: 'Los jugadores pueden volver a la pista con una tecla.', en: 'Players may put the car back on track with a key.' } }),
  x({ id: 'sessionVote', key: 'EnableSessionVote', kind: 'bool', def: true, group: 'ai', tier: 'mid',
    label: { es: 'Votar para pasar de sesión', en: 'Session vote' }, help: { es: 'Activa la votación de siguiente sesión.', en: 'Enables the next-session vote.' } }),
  x({ id: 'kickVote', key: 'EnableKickPlayerVote', kind: 'bool', def: true, group: 'ai', tier: 'mid',
    label: { es: 'Votar para expulsar', en: 'Kick vote' }, help: { es: 'Activa la votación para expulsar a un jugador.', en: 'Enables voting to kick a player.' } }),
  x({ id: 'kickMinPlayers', key: 'VoteKickMinimumConnectedPlayers', kind: 'int', def: 3, min: 1, max: 100, step: 1, group: 'ai', tier: 'adv',
    label: { es: 'Mínimo de jugadores para votar una expulsión', en: 'Minimum players for a kick vote' }, help: { es: 'Con menos jugadores conectados no se puede votar.', en: 'With fewer connected players a vote cannot start.' } }),
  x({ id: 'globalDrs', key: 'EnableGlobalDrs', kind: 'bool', def: true, group: 'ai', tier: 'adv',
    label: { es: 'DRS global', en: 'Global DRS' }, help: { es: 'El DRS se puede usar en todo el circuito.', en: 'DRS can be used anywhere on the track.' } }),
  x({ id: 'unlimitedP2P', key: 'EnableUnlimitedP2P', kind: 'bool', def: true, group: 'ai', tier: 'adv',
    label: { es: 'Push-to-pass ilimitado', en: 'Unlimited push-to-pass' }, help: { es: 'El push-to-pass no tiene límite de usos.', en: 'Push-to-pass has no usage limit.' } }),
  x({ id: 'forceLights', key: 'ForceLights', kind: 'bool', def: false, group: 'ai', tier: 'adv',
    label: { es: 'Forzar las luces', en: 'Force lights' }, help: { es: 'Los coches llevan las luces encendidas.', en: 'Cars have their lights on.' } }),
  x({ id: 'rainGrip', key: 'RainTrackGripReductionPercent', kind: 'int', def: 0, min: 0, max: 100, step: 1, unit: '%', group: 'ai', tier: 'adv',
    label: { es: 'Pérdida de agarre con lluvia', en: 'Grip lost in rain' }, help: { es: 'Cuánto agarre pierde la pista con lluvia (solo con WeatherFX).', en: 'How much grip the track loses in rain (WeatherFX only).' } }),

  // ---- Red y rendimiento ----
  s({ id: 'sendHz', key: 'CLIENT_SEND_INTERVAL_HZ', kind: 'int', def: 20, min: 1, max: 120, step: 1, unit: 'Hz', group: 'network', tier: 'adv',
    label: { es: 'Actualizaciones por segundo', en: 'Updates per second' }, help: { es: 'Frecuencia con la que el servidor manda posiciones. Más = más suave y más tráfico.', en: 'How often the server sends positions. Higher = smoother and more traffic.' } }),
  s({ id: 'threads', key: 'NUM_THREADS', kind: 'int', def: 2, min: 1, max: 32, step: 1, group: 'network', tier: 'adv',
    label: { es: 'Hilos del servidor', en: 'Server threads' }, help: { es: 'Hilos de proceso que usa el servidor.', en: 'Processing threads the server uses.' } }),
  s({ id: 'lobby', key: 'REGISTER_TO_LOBBY', kind: 'bool', def: false, group: 'network', tier: 'adv',
    label: { es: 'Registrar en el lobby de Kunos', en: 'Register in the Kunos lobby' }, help: { es: 'Aparece en la lista pública de servidores del juego (Content Manager usa la suya aparte).', en: 'Appears in the game\'s public server list (Content Manager uses its own).' } }),
];

export const SETTINGS_BY_ID: ReadonlyMap<string, SettingSpec> = new Map(SETTINGS.map((p) => [p.id, p]));

export type SettingValue = number | string | boolean;

/** Texto (`es` o `en`) de un `Txt`. */
export const txt = (v: Txt, lang: 'es' | 'en'): string => (lang === 'en' ? v.en : v.es);

/** Comprueba y normaliza un valor contra su ajuste. Lanza con un mensaje en español si no vale. */
export function validateSetting(spec: SettingSpec, v: unknown): SettingValue {
  const name = spec.label.es;
  switch (spec.kind) {
    case 'bool':
      if (typeof v !== 'boolean') throw new Error(`${name}: debe ser sí o no.`);
      return v;
    case 'text': {
      if (typeof v !== 'string') throw new Error(`${name}: debe ser texto.`);
      const t = v.trim();
      if (t.length > 200 || /[\r\n[\]=]/.test(t)) throw new Error(`${name}: texto no válido (sin saltos de línea ni corchetes, máximo 200 caracteres).`);
      return t;
    }
    case 'choice':
      if (typeof v !== 'number' || !spec.choices?.some((c) => c.value === v)) throw new Error(`${name}: opción no válida.`);
      return v;
    case 'int':
    case 'float': {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name}: debe ser un número.`);
      if (spec.kind === 'int' && !Number.isInteger(v)) throw new Error(`${name}: debe ser un número entero.`);
      if (spec.min !== undefined && v < spec.min || spec.max !== undefined && v > spec.max) throw new Error(`${name}: debe estar entre ${spec.min} y ${spec.max}.`);
      return v;
    }
  }
}

// ---- Sesiones (práctica, clasificación, carrera) ----

export type SessionId = 'practice' | 'qualify' | 'race';
export const SESSION_IDS: readonly SessionId[] = ['practice', 'qualify', 'race'];
/** Sección del ini de cada sesión. */
export const SESSION_SECTION: Record<SessionId, string> = { practice: 'PRACTICE', qualify: 'QUALIFY', race: 'RACE' };
export const SESSION_LABEL: Record<SessionId, Txt> = {
  practice: { es: 'Práctica', en: 'Practice' }, qualify: { es: 'Clasificación', en: 'Qualifying' }, race: { es: 'Carrera', en: 'Race' },
};
/** 0 = cerrada, 1 = abierta, 2 = abierta hasta que empieza. */
export const IS_OPEN_CHOICES: { value: number; label: Txt }[] = [
  { value: 1, label: { es: 'Se puede entrar', en: 'Open to join' } },
  { value: 2, label: { es: 'Se cierra al empezar', en: 'Closes when it starts' } },
  { value: 0, label: { es: 'Cerrada', en: 'Closed' } },
];

export interface SessionPlan {
  enabled: boolean;
  /** Carreras: por vueltas o por tiempo. Práctica y clasificación son siempre por tiempo. */
  mode: 'time' | 'laps';
  /** Minutos (en `time`). */
  minutes: number;
  /** Vueltas (en `laps`, solo carrera). */
  laps: number;
  isOpen: number;
  /** Solo carrera: segundos de espera en la parrilla antes de la salida. */
  waitSeconds: number;
}

export type SessionsPlan = Record<SessionId, SessionPlan>;

export const DEFAULT_SESSIONS: SessionsPlan = {
  practice: { enabled: true, mode: 'time', minutes: 60, laps: 0, isOpen: 1, waitSeconds: 0 },
  qualify: { enabled: false, mode: 'time', minutes: 10, laps: 0, isOpen: 1, waitSeconds: 0 },
  race: { enabled: true, mode: 'laps', minutes: 0, laps: 10, isOpen: 1, waitSeconds: 60 },
};

export function validateSessions(plan: unknown): SessionsPlan {
  if (typeof plan !== 'object' || plan === null) throw new Error('Sesiones no válidas.');
  const out = {} as SessionsPlan;
  for (const id of SESSION_IDS) {
    const p = (plan as Record<string, Partial<SessionPlan>>)[id];
    if (!p || typeof p !== 'object') throw new Error(`Falta la sesión «${SESSION_LABEL[id].es}».`);
    const int = (v: unknown, lo: number, hi: number, name: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${SESSION_LABEL[id].es}: ${name} debe ser un entero entre ${lo} y ${hi}.`);
      return v;
    };
    const mode = id === 'race' ? p.mode : 'time';
    if (mode !== 'time' && mode !== 'laps') throw new Error(`${SESSION_LABEL[id].es}: modo no válido.`);
    const isOpen = int(p.isOpen, 0, 2, 'el acceso');
    if (typeof p.enabled !== 'boolean') throw new Error(`${SESSION_LABEL[id].es}: «activa» debe ser sí o no.`);
    out[id] = {
      enabled: p.enabled, mode, isOpen,
      minutes: mode === 'time' ? int(p.minutes, 1, 1440, 'los minutos') : int(p.minutes ?? 0, 0, 1440, 'los minutos'),
      laps: mode === 'laps' ? int(p.laps, 1, 999, 'las vueltas') : int(p.laps ?? 0, 0, 999, 'las vueltas'),
      waitSeconds: id === 'race' ? int(p.waitSeconds, 0, 600, 'la espera') : 0,
    };
  }
  return out;
}

/** Datos del panel completo (lo que lee y escribe la ruta). */
export interface SessionPanelDto {
  values: Record<string, SettingValue>;
  sessions: SessionsPlan;
  /** Ajustes del `extra_cfg.yml` que no se han podido leer (archivo ausente). */
  extraMissing: boolean;
}

// ---- Presets de serie del panel de sesión (solo cambian ajustes, no las sesiones) ----

export interface SessionPresetDef { id: string; name: Txt; hint: Txt; values: Record<string, SettingValue> }

export const SESSION_PRESETS: SessionPresetDef[] = [
  { id: 'realistic', name: { es: 'Realista', en: 'Realistic' }, hint: { es: 'Combustible, daños y desgaste normales; ABS y TC según el coche; sin mantas.', en: 'Normal fuel, damage and wear; ABS and TC per car; no blankets.' },
    values: { fuelRate: 100, damageMultiplier: 100, tyreWearRate: 100, abs: 1, tc: 1, stability: false, autoclutch: false, blankets: false, tyresOut: 2 } },
  { id: 'friends', name: { es: 'Amigos', en: 'Friends' }, hint: { es: 'Sin combustible, sin daños ni desgaste; todas las ayudas permitidas; mantas sí.', en: 'No fuel use, no damage or wear; all assists allowed; blankets on.' },
    values: { fuelRate: 0, damageMultiplier: 0, tyreWearRate: 0, abs: 2, tc: 2, stability: true, autoclutch: true, blankets: true, tyresOut: 4 } },
  { id: 'league', name: { es: 'Liga', en: 'League' }, hint: { es: 'Daños y desgaste reales, ayudas según el coche, sin mantas y con cortes estrictos.', en: 'Real damage and wear, assists per car, no blankets and strict cuts.' },
    values: { fuelRate: 100, damageMultiplier: 100, tyreWearRate: 100, abs: 1, tc: 1, stability: false, autoclutch: false, blankets: false, tyresOut: 2, startRule: 2 } },
];
