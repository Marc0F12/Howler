import { describe, expect, it } from 'vitest';
import { transformExtraCfg } from './transform';

// Misma estructura que el extra_cfg.yml real de un servidor con ScoreTracker (valores inventados).
const MULTI = `UseSteamAuth: false
EnableLegacyPluginInterface: false
EnableClientMessages: false
EnablePlugins:
  - ScoreTrackerPlugin
ScoreTrackerPlugin:
  DatabasePath: "ScoreTracker.db"
  EnableDiscord: true
AiParams:
  MaxSpeedKph: 80

# Primero, activa esto
EnableClientMessages: true

---
!ScoreTrackerConfiguration
# Tipo de servidor
ServerType: 2
BroadcastMessages: true

---
IgnoreConfigurationErrors:
  MissingTrackParams: true

TrackParams:
  soyo_royal_raceway:
    Latitude: 0
    Longitude: 0
`;

describe('extra_cfg.yml con varios documentos', () => {
  const r = transformExtraCfg(MULTI, { availablePlugins: ['HowlerPlugin'] });

  it('deja un solo documento (la versión nueva no admite más) y conserva lo válido del principal', () => {
    expect(r.text).not.toContain('ScoreTracker');
    expect(r.text).not.toContain('ServerType');
    expect(r.text).toContain('MaxSpeedKph: 80');
    expect(r.text).not.toMatch(/^---$/m);
  });

  it('avisa de lo que contenían los documentos eliminados', () => {
    expect(r.warnings.join(' ')).toContain('TrackParams');
    expect(r.text).not.toContain('soyo_royal_raceway');
  });

  it('aplica los cambios al documento principal', () => {
    expect(r.text).toContain('EnableLegacyPluginInterface: true');
    expect(r.text).toMatch(/EnablePlugins:\s*\n\s*- HowlerPlugin/);
    expect(r.text.match(/EnableClientMessages/g)).toHaveLength(1);
    expect(r.text).toContain('EnableClientMessages: true');
  });

  it('activa MissingTrackParams una sola vez', () => {
    expect(r.text.match(/MissingTrackParams: true/g)).toHaveLength(1);
  });

  it('es idempotente', () => {
    const again = transformExtraCfg(r.text, { availablePlugins: ['HowlerPlugin'] });
    expect(again.text).toBe(r.text);
    expect(again.changes).toEqual([]);
  });
});
