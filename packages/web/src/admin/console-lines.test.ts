import { describe, expect, it } from 'vitest';
import { parseLogLine } from './console-lines';

describe('parseLogLine', () => {
  it('separa hora, nivel y texto', () => {
    expect(parseLogLine('[22:38:17 WRN] Welcome message not found')).toMatchObject({ level: 'wrn', time: '22:38:17', tag: 'WRN', text: 'Welcome message not found' });
    expect(parseLogLine('[22:38:17 DBG] x').level).toBe('dbg');
  });
  it('pega el volcado de una excepción a su error y pinta aparte los avisos de Howler y las rayas', () => {
    const fatal = parseLogLine('[22:38:17 FTL] Fatal exception occurred');
    const ex = parseLogLine('AssettoServer.Configuration.ConfigurationException: No track params', fatal);
    expect(ex).toMatchObject({ level: 'ftl', cont: true });
    expect(parseLogLine('at A.B() in x.cs:line 2', ex)).toMatchObject({ level: 'ftl', cont: true });
    expect(parseLogLine('[22:38:18 INF] siguiente', ex).level).toBe('inf');
    expect(parseLogLine('línea normal').level).toBe('plain');
    expect(parseLogLine('[howler] el servidor se cerró solo').level).toBe('howler');
    expect(parseLogLine('─'.repeat(40)).level).toBe('rule');
  });
});
