import { useEffect, useRef, useState } from 'react';
import { BUILTIN_SOUNDS, MAX_SOUND_BYTES, NO_SOUND, VOLUME_STYLES, type SoundsDto, type VolumeStyle } from '@howler/shared';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Field, Notice, useNotice } from './ui';
import { audioSeconds, builtinLabels, playSound } from '../sound';
import { t } from '../i18n';

/** Tipo MIME que acepta el servidor según la extensión (los navegadores dan nombres distintos para el mismo formato). */
function mimeOf(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : null;
}

/** Sonido del aviso de récord de la web pública: uno de serie o uno propio (corto). Cada visitante lo silencia desde su botón. */
export function SoundsCard() {
  const [sounds, setSounds] = useState<SoundsDto | null>(null);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { notice, show, run } = useNotice();
  const load = () => adminApi.sounds().then(setSounds).catch((e: Error) => show(false, e.message));
  useEffect(() => { void load(); }, []);
  if (!sounds) return <Card title={t('Sonido de récord')}><Notice notice={notice} /></Card>;

  const labels = builtinLabels(t);
  const test = (id: string) => { void playSound(id, sounds, { force: true }); };
  const choose = async (record: string) => { if (await run(() => adminApi.selectSound(record).then(setSounds), t('Sonido guardado.'))) test(record); };
  const upload = async (file: File) => {
    const mime = mimeOf(file);
    if (!mime) return show(false, t('Solo se admiten sonidos WAV, MP3 u OGG.'));
    if (file.size > MAX_SOUND_BYTES) return show(false, t('El sonido pesa demasiado (máximo {kb} KB).', { kb: Math.round(MAX_SOUND_BYTES / 1000) }));
    const secs = await audioSeconds(file);
    if (secs == null) return show(false, t('No se pudo leer ese archivo de audio.'));
    if (secs > sounds.maxSeconds + 0.05) return show(false, t('El sonido dura {s} s y el máximo es {max} s.', { s: secs.toFixed(1), max: sounds.maxSeconds }));
    await run(() => adminApi.uploadSound(file, mime, name || file.name.replace(/\.[^.]+$/, ''), secs).then((s) => { setSounds(s); setName(''); if (fileRef.current) fileRef.current.value = ''; }), t('Sonido subido.'));
  };

  const styleLabels: Record<VolumeStyle, string> = { banana: t('Lanzar la banana (minijuego)'), roulette: t('Girar la ruleta (minijuego)'), slider: t('Deslizador clásico') };
  return (
    <Card title={t('Sonido de récord')}>
      <Field label={t('Sonido del aviso de récord')} hint={t('Suena en la web de cada visitante que tenga el sonido activado (botón del altavoz arriba a la derecha; de serie está silenciado) cuando alguien bate un récord.')}>
        <div className="row">
          <select value={sounds.record} onChange={(e) => void choose(e.target.value)} aria-label={t('Sonido del aviso de récord')}>
            <option value={NO_SOUND}>{t('Sin sonido')}</option>
            {BUILTIN_SOUNDS.map((id) => <option key={id} value={id}>{labels[id]}</option>)}
            {sounds.custom.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="btn" disabled={sounds.record === NO_SOUND} onClick={() => test(sounds.record)}>{t('Probar')}</button>
        </div>
      </Field>
      <Field label={t('Control de volumen')} hint={t('Cómo regulan el volumen los visitantes. Los minijuegos se usan manteniendo pulsado (banana) o girando (ruleta); con el teclado, las flechas lo suben y bajan de 5 en 5.')}>
        <select value={sounds.volumeStyle} onChange={(e) => void run(() => adminApi.setVolumeStyle(e.target.value).then(setSounds), t('Control de volumen guardado.'))} aria-label={t('Control de volumen')}>
          {VOLUME_STYLES.map((v) => <option key={v} value={v}>{styleLabels[v]}</option>)}
        </select>
      </Field>
      <Field label={t('Sonidos propios')} hint={t('WAV, MP3 u OGG de hasta {max} s y {kb} KB. Si dura más, no se admite, y la web nunca reproduce más de {max} s aunque el archivo diga otra cosa.', { max: sounds.maxSeconds, kb: Math.round(MAX_SOUND_BYTES / 1000) })}>
        <div className="row">
          <input type="text" maxLength={40} placeholder={t('Nombre (opcional)')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Nombre del sonido')} />
          <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg" aria-label={t('Subir un sonido propio')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
        {sounds.custom.length > 0 && (
          <ul className="plain">
            {sounds.custom.map((c) => (
              <li key={c.id} className="row between">
                <span>{c.name} <span className="muted">· {c.seconds} s</span></span>
                <span className="row">
                  <button type="button" className="btn small" onClick={() => test(c.id)}>{t('Probar')}</button>
                  <ConfirmButton label={t('Borrar')} onConfirm={() => run(() => adminApi.deleteSound(c.id).then(setSounds), t('Sonido borrado.'))} danger />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Notice notice={notice} />
    </Card>
  );
}
