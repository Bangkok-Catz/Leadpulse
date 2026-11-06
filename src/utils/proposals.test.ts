import { describe, expect, it } from 'vitest';
import {
  dbdSearchUrl,
  displayQuote,
  decisionText,
  displayUrl,
  parseProposalCallback,
  proposalButtons,
  proposalMessage,
  stillAsProposed,
  type EnrichmentProposal,
  dayLabel,
  newLeadDeal,
  nextOwnerSearch,
} from './proposals';

const ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

const proposal = (over: Partial<EnrichmentProposal> = {}): EnrichmentProposal => ({
  id: ID,
  entity_type: 'company',
  entity_id: 'c0ffee00-0000-4000-8000-000000000001',
  company_id: 'c0ffee00-0000-4000-8000-000000000001',
  field: 'website',
  value: 'https://www.gateauxhouse.co.th/',
  current_value: null,
  source_url: 'https://www.gateauxhouse.co.th/',
  source_tier: 'own_site',
  quote: 'Gateaux House — Bakery & Café since 1998',
  quote_check: 'passed',
  reason: 'search result 1 for "Gateaux House Bangkok"; the homepage names the company',
  status: 'pending',
  decision_note: null,
  run_ref: 'website-finder 2026-10-14T20:00+07:00',
  proposed_at: '2026-10-14T13:00:00Z',
  telegram_message_id: null,
  sent_at: null,
  decided_at: null,
  ...over,
});

describe('proposalMessage', () => {
  it('asks one question with the value, the exact quote and where it came from', () => {
    const text = proposalMessage(proposal(), 'Gateaux House');
    const lines = text.split('\n');
    expect(lines[0]).toBe('<b>Website for Gateaux House?</b>');
    expect(lines[1]).toBe('<a href="https://www.gateauxhouse.co.th/">gateauxhouse.co.th</a>');
    expect(text).toContain('<i>“Gateaux House — Bakery &amp; Café since 1998”</i>');
    expect(text).toContain('(their own site)');
    expect(text).not.toContain('Replaces:');
  });

  it('escapes names and quotes, and shortens a long quote', () => {
    const text = proposalMessage(proposal({ quote: `<script>${'x'.repeat(400)}` }), 'Salt & <Butter>');
    expect(text).toContain('Website for Salt &amp; &lt;Butter&gt;?');
    expect(text).not.toContain('<script>');
    expect(text).toContain('…”</i>');
  });

  it('says what it would replace', () => {
    expect(proposalMessage(proposal({ current_value: 'http://old.example' }), 'X')).toContain('Replaces: http://old.example');
  });
});

describe('owner / decision-maker proposals', () => {
  const owner = proposal({
    field: 'decision_maker', value: 'Janista Lewchalermvongse (Bam)', source_url: 'https://www.audreygroup.com/About.html',
    quote: 'Janista Lewchalermvongse (Bam), the founder of Audrey Café & Restaurant chain',
    details: { job_title: 'Founder', dbd_keyword: 'ออเดรย์ กรุ๊ป' }, reason: null,
  });

  it('names the person and role, quotes the source and links DBD for a manual check', () => {
    const text = proposalMessage(owner, 'Audrey Group');
    const lines = text.split('\n');
    expect(lines[0]).toBe('<b>Owner / decision maker for Audrey Group?</b>');
    expect(lines[1]).toBe('<b>Janista Lewchalermvongse (Bam)</b> — Founder');
    expect(text).toContain(`<a href="${dbdSearchUrl('ออเดรย์ กรุ๊ป')}">DBD search</a>`);
    expect(text).toContain('Save adds them as a new contact (uncontacted)');
  });

  it('searches DBD by company name when no legal name is known', () => {
    expect(proposalMessage({ ...owner, details: { job_title: 'Founder' } }, 'Audrey Group')).toContain(dbdSearchUrl('Audrey Group'));
  });

  it('encodes the DBD keyword', () => {
    expect(dbdSearchUrl(' กาโตว์ เฮ้าส์ ')).toBe('https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=%E0%B8%81%E0%B8%B2%E0%B9%82%E0%B8%95%E0%B8%A7%E0%B9%8C%20%E0%B9%80%E0%B8%AE%E0%B9%89%E0%B8%B2%E0%B8%AA%E0%B9%8C');
  });

  it('labels a press source plainly', () => {
    expect(proposalMessage({ ...owner, source_tier: 'press' }, 'Audrey Group')).toContain('(a press interview, article or guide)');
  });
});

describe('profile and new-lead proposals', () => {
  it('shows a text field as text, not a link', () => {
    const text = proposalMessage(proposal({ field: 'what_they_make', value: 'mille-feuille & opera cake' }), 'Gateaux House');
    expect(text.split('\n').slice(0, 2)).toEqual(['<b>What they make for Gateaux House?</b>', '<b>mille-feuille &amp; opera cake</b>']);
  });

  it('introduces a new lead with its type, area, Laya fit and what Save does', () => {
    const lead = proposal({
      field: 'new_company', value: 'Kind Kones Bakery', entity_id: null, company_id: null, source_tier: 'press',
      details: { industry: 'Bakery', area: 'Ari', what_they_make: 'vegan croissants', archetype: 'bakery', fit_noul: 0.814 },
    });
    const text = proposalMessage(lead, 'Kind Kones Bakery');
    const lines = text.split('\n');
    expect(lines[0]).toBe('<b>New lead: Kind Kones Bakery?</b>');
    expect(lines[1]).toBe('Bakery · Ari');
    expect(text).toContain('Makes: vegan croissants');
    expect(text).toContain('Laya: bakery 81%');
    expect(text).toContain('Add creates the account and a Research deal');
    expect(text).not.toContain('Signal');
  });

  it('puts a buying signal right under the lead', () => {
    const lead = proposal({
      field: 'new_company', value: 'Nook Bakery', entity_id: null, company_id: null, source_tier: 'official_listing',
      details: { industry: 'Bakery', area: 'Ari', signal: 'hiring a pastry chef', fit_noul: 0.7 },
    });
    expect(proposalMessage(lead, 'Nook Bakery').split('\n')[2]).toBe('📣 Signal: <b>hiring a pastry chef</b>');
  });
});

describe('displayQuote', () => {
  it('reads like the page, without markdown', () => {
    expect(displayQuote('- โรงงาน ที่อยู่ : 51/2 ซอย วัดไทร')).toBe('โรงงาน ที่อยู่ : 51/2 ซอย วัดไทร');
    expect(displayQuote('###### Restaurateur & Co-Founder\n\n### Tao Ingudananda')).toBe('Restaurateur & Co-Founder Tao Ingudananda');
    expect(displayQuote('Email: [hello@x.example](mailto:hello@x.example) and **bold**')).toBe('Email: hello@x.example and bold');
    expect(displayQuote('Price 5 - 10 kg')).toBe('Price 5 - 10 kg');
  });

  it('is what Telegram shows', () => {
    expect(proposalMessage(proposal({ field: 'address', value: 'x', quote: '- Floor 2, Room 2A' }), 'Belén')).toContain('“Floor 2, Room 2A”');
  });
});

describe('buttons', () => {
  it('round-trips both buttons within Telegram’s 64-byte limit', () => {
    const [[save, reject]] = proposalButtons(ID);
    expect(Buffer.byteLength(save.callback_data)).toBeLessThanOrEqual(64);
    expect(parseProposalCallback(save.callback_data)).toEqual({ id: ID, action: 'save' });
    expect(parseProposalCallback(reject.callback_data)).toEqual({ id: ID, action: 'reject' });
  });

  it('labels the buttons for what Save does', () => {
    expect(proposalButtons(ID, 'new_company').map(r => r.map(b => b.text))).toEqual([['✅ Add'], ['Closed', 'Customer', 'Not a fit']]);
    expect(proposalButtons(ID, 'decision_maker')[0].map(b => b.text)).toEqual(['✅ Save', '❌ Not right']);
    expect(proposalButtons(ID, 'address')[0].map(b => b.text)).toEqual(['✅ Save', '❌ Not theirs']);
    expect(parseProposalCallback(proposalButtons(ID, 'new_company')[0][0].callback_data)).toEqual({ id: ID, action: 'save' });
  });

  it('skips a new lead with a reason, and offers a look-alike account', () => {
    const same = { id: 'c0ffee00-0000-4000-8000-000000000009', name: 'Earthling Cafe and Bakery Bangkok', status: 'active_customer', why: 'name looks alike' };
    const rows = proposalButtons(ID, 'new_company', { industry: 'Vegan Restaurant', maybe_same: same });
    expect(rows.map(r => r.map(b => b.text))).toEqual([['✅ Add', `🔗 Same as ${same.name.slice(0, 21)}…`], ['Closed', 'Customer', 'Not a fit']]);
    for (const button of rows.flat()) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    expect(rows.flat().map(b => parseProposalCallback(b.callback_data))).toEqual([
      { id: ID, action: 'save' }, { id: ID, action: 'same' },
      { id: ID, action: 'reject', reason: 'closed' }, { id: ID, action: 'reject', reason: 'customer' }, { id: ID, action: 'reject', reason: 'not_fit' },
    ]);
    expect(proposalButtons(ID, 'new_company', { industry: 'x' })[0]).toHaveLength(1);
  });

  it('says how a lead was skipped or linked', () => {
    expect(decisionText('rejected', null, 'closed').footer).toContain('Skipped: closed');
    expect(decisionText('rejected', 'same as Earthling Cafe', 'customer').footer).toContain('Linked:</b> same as Earthling Cafe');
    expect(decisionText('rejected').footer).toContain('Not saved');
  });

  it('warns about a look-alike and how it was checked as open', () => {
    const text = proposalMessage(proposal({
      field: 'new_company', value: 'Earth House', entity_id: null, company_id: null, source_tier: 'press',
      details: { industry: 'Vegan Restaurant', maybe_same: { id: 'c9', name: 'Earthling Cafe', status: 'active_customer', why: '"earth" in both names' }, open_check: 'their site loads (earthlingbangkok.com)' },
    }), 'Earth House');
    expect(text).toContain('⚠️ Might be <b>Earthling Cafe</b> (active customer): &quot;earth&quot; in both names'.replace('&quot;', '"').replace('&quot;', '"'));
    expect(text).toContain('Open: their site loads (earthlingbangkok.com)');
  });

  it('ignores anything else', () => {
    for (const data of [undefined, 42, '', 'p:not-a-uuid:s', `p:${ID}:x`, `p:${ID}:s extra`, `q:${ID}:s`]) {
      expect(parseProposalCallback(data)).toBeNull();
    }
  });
});

describe('stillAsProposed', () => {
  it('fills only what the proposal saw', () => {
    expect(stillAsProposed(proposal(), null)).toBe(true);
    expect(stillAsProposed(proposal(), '')).toBe(true);
    expect(stillAsProposed(proposal(), 'https://typed-by-pat.example')).toBe(false);
    expect(stillAsProposed(proposal({ current_value: 'http://old.example' }), 'http://old.example')).toBe(true);
  });
});

describe('displayUrl / decisionText', () => {
  it('shows a bare host and path', () => {
    expect(displayUrl('https://www.restaurant-stage.co/contact/')).toBe('restaurant-stage.co/contact');
    expect(displayUrl('not a url')).toBe('not a url');
  });

  it('says plainly what happened', () => {
    expect(decisionText('applied').footer).toContain('Saved to LeadPulse');
    expect(decisionText('applied', 'company c; deal d', null, '2026-10-27')).toEqual({
      footer: "✅ <b>Added to LeadPulse.</b> Owner search Tue 27 Oct, then it's on This week.",
      toast: 'Added · on This week Tue 27 Oct',
    });
    expect(decisionText('rejected').footer).toContain('Not saved');
    expect(decisionText('stale', 'website is now https://x.example').footer).toContain('website is now https://x.example');
  });
});

describe('a new lead’s first step', () => {
  it('waits for the next Tuesday or Thursday owner search', () => {
    expect(nextOwnerSearch('2026-10-19')).toBe('2026-10-20'); // Mon → Tue
    expect(nextOwnerSearch('2026-10-20')).toBe('2026-10-22'); // Tue (after the run) → Thu
    expect(nextOwnerSearch('2026-10-22')).toBe('2026-10-27'); // Thu → next Tue
    expect(nextOwnerSearch('2026-10-24')).toBe('2026-10-27'); // Sat → Tue
    expect(dayLabel('2026-10-27')).toBe('Tue 27 Oct');
  });

  it('is a Research deal, high priority only when Laya judged a fit', () => {
    expect(newLeadDeal('c1', 'Larna House', 0.12, '2026-10-22')).toMatchObject({ title: 'Larna House — Butter', stage: 'research', priority: 'medium', followup_date: '2026-10-27' });
    expect(newLeadDeal('c1', 'Larna House', 0.81, '2026-10-22').priority).toBe('high');
    expect(newLeadDeal('c1', 'Larna House', undefined, '2026-10-22').priority).toBe('medium');
  });
});
