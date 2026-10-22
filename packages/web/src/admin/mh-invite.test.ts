import { describe, expect, it } from 'vitest';
import { inviteText, parseInvite } from './mh-invite';

describe('invitación de MultiHowler', () => {
  it('saca dirección y clave de la invitación entera, en cualquier orden y con texto alrededor', () => {
    const key = 'HWL-7K3Q-9MZP-AB12-XY34';
    expect(parseInvite(inviteText('http://203.0.113.5:8420', key))).toEqual({ url: 'http://203.0.113.5:8420', key });
    expect(parseInvite(`hola! clave: ${key.toLowerCase()} y mi web es https://howler.ejemplo.com.`)).toEqual({ url: 'https://howler.ejemplo.com', key });
  });
  it('acepta solo una de las dos cosas y no inventa nada', () => {
    expect(parseInvite('http://192.168.1.20:8420')).toEqual({ url: 'http://192.168.1.20:8420' });
    expect(parseInvite('HWL-AAAA-BBBB-CCCC-DDDD')).toEqual({ key: 'HWL-AAAA-BBBB-CCCC-DDDD' });
    expect(parseInvite('mi servidor')).toEqual({});
    expect(parseInvite('javascript:alert(1)')).toEqual({});
  });
});
