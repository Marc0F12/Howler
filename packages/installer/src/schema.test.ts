import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformExtraCfg } from './transform';

const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'extra_cfg.schema.pre35.json'), 'utf8'));
const opts = { availablePlugins: ['HowlerPlugin', 'AutoModerationPlugin'], schema };

const OLD = `UseSteamAuth: false
EnableAntiAfk: true
MaxAfkTimeMinutes: 10
MaxPing: 500
EnableWeatherFx: true
LoadingImageUrl: https://example.com/a.jpg
IgnoreConfigurationErrors:
  MissingCarChecksums: false
  WrongServerDetails: false
AiParams:
  MaxSpeedKph: 80
  CampoInventado: 1
UserGroups:
  mi_grupo: mi_grupo.txt
---
TrackParams:
  mi_circuito:
    Latitude: 1
    Longitude: 2
`;

describe('migración según el esquema de la versión nueva', () => {
  const r = transformExtraCfg(OLD, opts);

  it('quita las opciones que ya no existen y avisa de a dónde han ido', () => {
    expect(r.text).not.toContain('EnableAntiAfk');
    expect(r.text).not.toContain('MaxPing');
    expect(r.text).not.toContain('WrongServerDetails');
    expect(r.changes.join('\n')).toContain('AutoModerationPlugin');
    expect(r.warnings.join('\n')).toContain('AiParams.CampoInventado');
  });

  it('conserva todo lo que sigue siendo válido, incluidos diccionarios libres', () => {
    expect(r.text).toContain('UseSteamAuth: false');
    expect(r.text).toContain('EnableWeatherFx: true');
    expect(r.text).toContain('MissingCarChecksums: false');
    expect(r.text).toContain('MaxSpeedKph: 80');
    expect(r.text).toContain('mi_grupo: mi_grupo.txt');
  });

  it('TrackParams ya no existe en la versión nueva: se quita con aviso y el documento vacío desaparece', () => {
    expect(r.text).not.toContain('mi_circuito');
    expect(r.warnings.join(' ')).toContain('TrackParams');
    expect(r.text).not.toMatch(/^---$/m);
  });

  it('LoadingImageUrl pasa a la lista LoadingImageUrls', () => {
    expect(r.text).not.toMatch(/LoadingImageUrl:/);
    expect(r.text).toMatch(/LoadingImageUrls:\s*\n\s*- https:\/\/example\.com\/a\.jpg/);
  });

  it('el resultado es estable al migrar de nuevo', () => {
    const again = transformExtraCfg(r.text, opts);
    expect(again.text).toBe(r.text);
  });
});
