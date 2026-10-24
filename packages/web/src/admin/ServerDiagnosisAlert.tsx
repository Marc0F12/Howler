import { useCallback, useEffect, useState } from 'react';
import type { ServerDiagnosisDto } from '@howler/shared';
import { t } from '../i18n';
import { adminApi } from './adminApi';
import { Notice, useNotice } from './ui';

/** Problemas que harían caer el servidor al arrancar y que Howler ve de antemano (hoy: circuito sin datos de ubicación). */
export function useServerPreflight(stopped: boolean) {
  const [list, setList] = useState<ServerDiagnosisDto[]>([]);
  const reload = useCallback(() => { void adminApi.serverDiagnosis().then(setList, () => setList([])); }, []);
  useEffect(() => { if (stopped) reload(); }, [stopped, reload]);
  return { preflight: list, reload };
}

const DOCS = 'https://assettoserver.org/docs/common-configuration-errors';

/** Título y explicación de cada causa conocida. Los datos concretos vienen en `params`. */
function describe(d: ServerDiagnosisDto): { title: string; why: string; hint?: string } {
  const p = d.params;
  switch (d.id) {
    case 'track-params':
      return {
        title: t('Faltan los datos de ubicación del circuito «{track}».', { track: p.track ?? '?' }),
        why: t('AssettoServer necesita saber dónde está el circuito (latitud, longitud y huso horario) para calcular el sol y la hora. Los busca en cfg/data_track_params.ini y «{track}» no aparece, algo normal en circuitos de mods. Sin ese dato se niega a arrancar.', { track: p.track ?? '?' }),
        hint: t('Con el arreglo el servidor usará la hora UTC en este circuito. Si quieres el sol y la hora exactos, añade a cfg/data_track_params.ini una sección [{track}] con LATITUDE, LONGITUDE, TIMEZONE y NAME.', { track: p.track ?? '?' }),
      };
    case 'bad-timezone':
      return { title: t('El huso horario «{zone}» de «{track}» no es válido.', { zone: p.zone ?? '?', track: p.track ?? '?' }), why: t('Corrígelo en cfg/data_track_params.ini con un nombre válido, por ejemplo Europe/Madrid.') };
    case 'car-checksums':
      return { title: t('Hay coches sin data.acd ({cars}).', { cars: p.cars ?? '?' }), why: t('El servidor guarda una suma de control de cada coche a partir de su archivo data.acd. Si un coche no lo tiene, se niega a arrancar, salvo que le digas que lo permita.') };
    case 'admin-whitelist':
      return { title: t('Hay administradores en admins.txt pero el inicio de sesión con Steam está desactivado.'), why: t('Es inseguro: alguien podría hacerse pasar por un administrador. Activa «UseSteamAuth» en el extra_cfg.yml o vacía el archivo admins.txt.') };
    case 'port-in-use':
      return { title: t('Un puerto del servidor ya está en uso.'), why: t('Lo más probable es que haya otro servidor de AC abierto (por ejemplo, lanzado desde Content Manager) o dos servidores con los mismos puertos. Ciérralo, o cambia los puertos del server_cfg.ini (UDP_PORT, TCP_PORT y HTTP_PORT).') };
    case 'missing-file':
      return p.what === 'ai'
        ? { title: t('Falta la línea de IA del circuito (fast_lane.ai).'), why: t('El servidor la necesita para el tráfico y otras funciones. Pon un fast_lane.ai en la carpeta ai del circuito: {path}', { path: p.path ?? '?' }) }
        : { title: t('Falta un archivo o una carpeta: {path}', { path: p.path ?? '?' }), why: t('Comprueba que existe. Si es un coche o un circuito, puede que no esté instalado en la carpeta de contenido del servidor.') };
    case 'plugin':
      return p.plugin
        ? { title: t('No se encuentra el plugin «{plugin}».', { plugin: p.plugin }), why: t('Está activado en el extra_cfg.yml (EnablePlugins) pero su carpeta no está en plugins. Instálalo o quítalo de la lista.') }
        : { title: t('Un plugin no es compatible con esta versión de AssettoServer.'), why: t('Los plugins hechos para versiones antiguas (como la 0.0.54) suelen fallar. Quítalo de EnablePlugins o busca una versión actualizada. Detalle: {msg}', { msg: p.msg ?? '?' }) };
    case 'plugin-config':
      return { title: t('Algún plugin sigue configurado dentro del extra_cfg.yml.'), why: t('Desde la versión 0.0.55 cada plugin se configura en su propio archivo de la carpeta cfg. Borra esa configuración del extra_cfg.yml.') };
    case 'csp-version':
      return { title: t('Una función del servidor necesita CSP {version} (versión {build}) como mínimo.', { version: p.version ?? '?', build: p.build ?? '?' }), why: t('Sube el CSP mínimo exigido (MinimumCSPVersion en el extra_cfg.yml o la versión de CSP del circuito en Content Manager) o desactiva esa función.') };
    case 'no-entries':
      return { title: t('La lista de coches está vacía.'), why: t('Añade al menos un coche en Preparar → Circuito y coches.') };
    case 'bad-config':
      return { title: t('Hay un error en un archivo de configuración.'), why: t('Revisa el extra_cfg.yml y el server_cfg.ini (sangrías, dos puntos y valores). Detalle: {msg}', { msg: p.msg ?? '?' }) };
    case 'udp-plugin':
      return { title: t('Los puertos del plugin UDP están mal.'), why: t('Howler necesita UDP_PLUGIN_ADDRESS (por ejemplo 127.0.0.1:12000) y UDP_PLUGIN_LOCAL_PORT (por ejemplo 11000), distintos entre sí. Detalle: {msg}', { msg: p.msg ?? '?' }) };
    default:
      return p.msg
        ? { title: t('El servidor se cerró con un error que Howler no reconoce.'), why: `${p.type ?? ''}: ${p.msg}` }
        : { title: t('El servidor se cerró y la consola no muestra un error claro.'), why: t('Mira las últimas líneas de la consola; si ves «Fatal exception», copia el mensaje y búscalo en la documentación de AssettoServer.') };
  }
}

/**
 * Qué ha fallado (o fallaría) al arrancar el servidor y cómo arreglarlo. Une la comprobación previa con lo que dijo la consola
 * en la última caída. Los coches sin data.acd los trata `CarChecksumAlert`, con más opciones.
 */
export function ServerDiagnosisAlert({ items, onChanged, onStartAnyway }: { items: ServerDiagnosisDto[]; onChanged: () => void; onStartAnyway?: () => void }) {
  const { notice, run } = useNotice();
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const shown = items.filter((d) => d.id !== 'car-checksums');
  if (shown.length === 0) return null;

  return (
    <div className="warn car-alert" role="alert">
      {shown.map((d) => {
        const { title, why, hint } = describe(d);
        const key = `${d.id}|${JSON.stringify(d.params)}`;
        return (
          <div key={key} className="diag-item">
            <b>{title}</b>
            <p className="hint">{why}</p>
            {hint && <p className="hint">{hint}</p>}
            {d.fix === 'allow-track-params' && !fixed.has(key) && (
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => run(async () => { await adminApi.serverFix('allow-track-params'); setFixed((s) => new Set(s).add(key)); onChanged(); return { ok: true }; }, t('Hecho: el servidor aceptará circuitos sin esos datos. Ya puedes arrancar.'))}>
                  {t('Permitir circuitos sin esos datos (recomendado)')}
                </button>
                {onStartAnyway && <button type="button" className="btn" onClick={onStartAnyway}>{t('Arrancar de todas formas')}</button>}
              </div>
            )}
          </div>
        );
      })}
      <p className="hint"><a href={DOCS} target="_blank" rel="noreferrer">{t('Más información sobre estos errores (documentación de AssettoServer)')}</a></p>
      <Notice notice={notice} />
    </div>
  );
}
