import { describe, expect, it } from 'vitest';
import type { Contact } from '@/types/crm';
import {
  channelLink, channelsOf, identityProblem, instagramHandle, lineHint, ownChannel, phoneHint, splitLegacyLine,
} from './contact-channels';

const contact = (over: Partial<Contact> = {}) =>
  ({ line: null, phone: null, email: null, instagram: null, whatsapp: null, ...over } as unknown as Contact);

describe('splitLegacyLine: what the old LINE box really holds (values from the live data)', () => {
  it.each([
    ['@holeybkk', { line: '@holeybkk', instagram: null, whatsapp: null }],
    ['https://lin.ee/JdI3EvO', { line: 'https://lin.ee/JdI3EvO', instagram: null, whatsapp: null }],
    ['Line https://lin.ee/JdI3EvO', { line: 'https://lin.ee/JdI3EvO', instagram: null, whatsapp: null }],
    ['IG @OHKAJHU', { line: null, instagram: 'OHKAJHU', whatsapp: null }],
    ['Instagram @juliapanchkowry', { line: null, instagram: 'juliapanchkowry', whatsapp: null }],
    ['@mango_love_vegan (Instagram)', { line: null, instagram: 'mango_love_vegan', whatsapp: null }],
    ['IG @flaneur.tea', { line: null, instagram: 'flaneur.tea', whatsapp: null }],
    ['Line @loaves / IG @loaves_glutenfreevegan', { line: '@loaves', instagram: 'loaves_glutenfreevegan', whatsapp: null }],
    ['Line OA @farmhousethai (line.me/@farmhousethai); Instagram @farmhousethai', { line: 'line.me/@farmhousethai', instagram: 'farmhousethai', whatsapp: null }],
    ['WhatsApp +65 9766 9860', { line: null, instagram: null, whatsapp: '+65 9766 9860' }],
    ['Restaurant WhatsApp 9161 8632 [F]', { line: null, instagram: null, whatsapp: '9161 8632' }],
    ['WhatsApp +62 822-1000-1014', { line: null, instagram: null, whatsapp: '+62 822-1000-1014' }],
  ])('%s', (raw, want) => {
    expect(splitLegacyLine(raw)).toMatchObject(want);
  });

  it('notes another app it cannot move', () => {
    expect(splitLegacyLine('Instagram @bm_grocery; Facebook Bangrakminimart.admin')).toEqual({ line: null, instagram: 'bm_grocery', whatsapp: null, other: true });
    // "TW Line@ store CS ... (ID not listed publicly)" names LINE but gives no ID: nothing is invented
    expect(splitLegacyLine('HK group WhatsApp +852 6039 9202 [F]; TW Line@ store CS mentioned (ID not listed publicly)'))
      .toMatchObject({ line: null, whatsapp: '+852 6039 9202' });
  });
});

describe('channelsOf and ownChannel', () => {
  it('reads Instagram out of an old LINE box, so the way in is named right', () => {
    const julia = contact({ line: 'Instagram @juliapanchkowry' });
    expect(channelsOf(julia)).toMatchObject({ line: null, instagram: 'juliapanchkowry' });
    expect(ownChannel(julia)).toEqual({ key: 'instagram', value: 'juliapanchkowry', label: 'Instagram' });
  });

  it('prefers the new boxes and goes LINE, Instagram, WhatsApp, phone, email', () => {
    expect(ownChannel(contact({ line: '@may', instagram: 'may', phone: '081' }))?.label).toBe('LINE');
    expect(ownChannel(contact({ instagram: 'may', phone: '081' }))?.label).toBe('Instagram');
    expect(ownChannel(contact({ whatsapp: '+65 9766 9860', email: 'a@b.co' }))?.label).toBe('WhatsApp');
    expect(ownChannel(contact({ email: 'a@b.co' }))?.label).toBe('email');
    expect(ownChannel(contact({ instagram: 'new_handle', line: 'IG @old_handle' }))?.value).toBe('new_handle');
    expect(ownChannel(contact({ line: '  ' }))).toBeNull();
  });
});

describe('links', () => {
  it('opens the right app', () => {
    expect(channelLink('instagram', '@ubuntueat')).toBe('https://instagram.com/ubuntueat');
    expect(channelLink('instagram', 'https://www.instagram.com/the.banana.warrior.cafe/')).toBe('https://instagram.com/the.banana.warrior.cafe');
    expect(channelLink('whatsapp', '+65 9766 9860')).toBe('https://wa.me/6597669860');
    expect(channelLink('line', '@holeybkk')).toBe('https://line.me/R/ti/p/@holeybkk');
    expect(channelLink('line', 'lin.ee/87jU1Qi')).toBe('https://lin.ee/87jU1Qi');
    expect(channelLink('phone', '+66 2 126 9999 (confirm)')).toBe('tel:+6621269999');
    expect(channelLink('email', 'not an email')).toBeNull();
    expect(instagramHandle('has spaces in it')).toBeNull();
  });
});

describe('phoneHint (values from the live data)', () => {
  it('leaves a single number alone, with or without a note or extension', () => {
    for (const ok of ['081 234 5678', 'M: +66 (0)65 929 1522', '+66 2 126 9999 (confirm)', '+66 2 673 9849 / 9851', '+66 2 137 2180 / 2200-4', '+66 38 570 386 ext 210']) {
      expect(phoneHint(ok)).toBeNull();
    }
  });

  it('catches what is not a number', () => {
    expect(phoneHint('0000')?.message).toBe('Too short to be a phone number');
    expect(phoneHint('7899')?.message).toBe('Too short to be a phone number');
    expect(phoneHint('ask at the counter')?.message).toBe('Not a phone number');
  });

  it('offers to move a second number, unless Alternate phone is taken', () => {
    expect(phoneHint('+66 80 135 0032 / +66 2 658 0932')).toEqual({
      message: 'Two numbers in one box', fix: { phone: '+66 80 135 0032', phone_second: '+66 2 658 0932' }, fixLabel: 'Move the second to Alternate phone',
    });
    expect(phoneHint('+66 80 135 0032 / +66 2 658 0932', { phone_second: '02 111' })?.fix).toBeUndefined();
    expect(phoneHint('064-105-9189 / 082-092-8362 / 083-812-6924 / 083-920-2516')?.message).toMatch(/^4 numbers in one box/);
  });

  it('sends a WhatsApp number to its own box', () => {
    expect(phoneHint('WhatsApp +66 82 695 4242')).toEqual({ message: 'This is a WhatsApp number', fix: { phone: '', whatsapp: '+66 82 695 4242' }, fixLabel: 'Move to WhatsApp' });
    expect(phoneHint('WhatsApp +66 82 695 4242', { whatsapp: '+66 1' })?.fix).toBeUndefined();
  });
});

describe('lineHint', () => {
  it('is quiet for a LINE ID', () => {
    expect(lineHint('@holeybkk')).toBeNull();
    expect(lineHint('https://lin.ee/87jU1Qi')).toBeNull();
  });

  it('moves Instagram and WhatsApp out, keeping the LINE part', () => {
    expect(lineHint('Line @loaves / IG @loaves_glutenfreevegan')).toEqual({
      message: 'This holds Instagram, not only LINE', fix: { line: '@loaves', instagram: 'loaves_glutenfreevegan' }, fixLabel: 'Move to Instagram',
    });
    expect(lineHint('WhatsApp +65 9766 9860')?.fix).toEqual({ line: '', whatsapp: '+65 9766 9860' });
  });

  it('asks Pat when it cannot move everything, or the box is already filled', () => {
    expect(lineHint('Instagram @bm_grocery; Facebook Bangrakminimart.admin')?.fix).toBeUndefined();
    expect(lineHint('IG @ubuntueat', { instagram: 'ubuntueat' })?.fix).toBeUndefined();
  });
});

describe('identityProblem', () => {
  it('asks who the contact is until it is said', () => {
    expect(identityProblem('unknown')).toMatch(/Say who this is/);
    expect(identityProblem(null)).toMatch(/Say who this is/);
    expect(identityProblem('named')).toBeNull();
    expect(identityProblem('company_route')).toBeNull();
  });
});
