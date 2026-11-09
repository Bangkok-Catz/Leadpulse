'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Company, Contact, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';

export type ActivityType = 'quick_action' | 'edit' | 'create' | 'delete' | 'restore' | 'merge';

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: ActivityType;
  entity: 'deal' | 'contact' | 'company' | 'meeting';
  entityId?: string;
  label: string;
  description?: string;
  undoPayload?: Record<string, any>;
  applied?: boolean;
}

interface CrmContextType {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  meetings: Meeting[];
  /** Per-company sales history (account_events) feeding retention scoring. */
  accountEvents: crm.AccountEvent[];
  /** Distinguishes an empty event history from a failed account_events read. */
  accountEventsUnavailable: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Saves the touch and returns the saved row (Undo needs its id). */
  addMeeting: (meeting: Omit<Meeting, 'id' | 'created_at'>) => Promise<Meeting | void>;
  createContact: (contact: Omit<Contact, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  createCompany: (company: Omit<Company, 'id' | 'created_at' | 'updated_at'>) => Promise<Company>;
  createDeal: (deal: Omit<Deal, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  deleteEntity: (entity: ActivityEntry['entity'], id: string, label: string) => Promise<void>;
  restoreEntity: (entity: ActivityEntry['entity'], id: string) => Promise<void>;
  activities: ActivityEntry[];
  /** Returns an id that undoActivity accepts, before and after the entry is saved. */
  logActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => string;
  markActivityApplied: (id: string) => void;
  undoActivity: (id: string) => Promise<boolean>;
}

const CrmContext = createContext<CrmContextType>({
  companies: [],
  contacts: [],
  deals: [],
  meetings: [],
  accountEvents: [],
  accountEventsUnavailable: false,
  loading: true,
  error: null,
  refresh: async () => {},
  addMeeting: async () => {},
  createContact: async () => {},
  createCompany: async () => ({}) as Company,
  createDeal: async () => {},
  deleteEntity: async () => {},
  restoreEntity: async () => {},
  activities: [],
  logActivity: () => '',
  markActivityApplied: () => {},
  undoActivity: async () => false,
});

// Map the UI entity name to its Supabase table name.
const TABLE_FOR: Record<ActivityEntry['entity'], 'companies' | 'contacts' | 'deals' | 'meetings'> = {
  company: 'companies',
  contact: 'contacts',
  deal: 'deals',
  meeting: 'meetings',
};

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [accountEvents, setAccountEvents] = useState<crm.AccountEvent[]>([]);
  const [accountEventsUnavailable, setAccountEventsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const initialized = useRef(false);
  const hasCompletedInitialLoad = useRef(false);
  // A toast's Undo keeps the id logActivity returned and runs after later renders: undo reads
  // the current entries, and a saved entry is found by the local id it started with.
  const activitiesRef = useRef<ActivityEntry[]>([]);
  const savedIds = useRef(new Map<string, string>());
  useEffect(() => { activitiesRef.current = activities; }, [activities]);

  const refresh = useCallback(async () => {
    // Only the first load blocks the page. Background refreshes must keep open
    // drawers/modals mounted so save errors and retry state are not destroyed.
    const showBlockingLoader = !hasCompletedInitialLoad.current;
    try {
      if (showBlockingLoader) setLoading(true);
      const [companiesRes, contactsRes, dealsRes, meetingsRes, eventsRes, acctEventsResult] = await Promise.all([
        crm.getCompanies(),
        crm.getContacts(),
        crm.getDeals(),
        crm.getMeetings(),
        crm.getActivityEvents().catch(() => [] as any[]),
        // Sales history powers retention scoring; if the table isn't provisioned
        // yet (pre-DDL) this degrades gracefully to [] and interim weights hold.
        crm.getAccountEvents()
          .then(data => ({ data, unavailable: false }))
          .catch(() => ({ data: [] as crm.AccountEvent[], unavailable: true })),
      ]);

      const mCompanies = (companiesRes || []) as any[];
      const mContacts = (contactsRes || []) as any[];
      const mDeals = (dealsRes || []) as any[];
      const mMeetings = (meetingsRes || []) as any[];

      setCompanies(mCompanies.map((el: any) => ({
        id: el.id,
        name: el.name,
        status: el.status,
        lead_source: el.lead_source,
        acquisition_source: el.acquisition_source ?? null,
        acquisition_campaign: el.acquisition_campaign ?? null,
        market: el.market === 'local' || el.market === 'export' ? el.market : null,
        account_owner: el.account_owner || 'Pat',
        tags: el.tags || [],
        industry: el.industry,
        size: el.size,
        address: el.address,
        website: el.website,
        // Saved by the account editor and by approved proposals; drafts and the panel read it.
        what_they_make: el.what_they_make ?? null,
        logo_url: el.logo_url ?? null,
        notes: el.notes,
        created_at: el.created_at || new Date().toISOString(),
        updated_at: el.updated_at || new Date().toISOString(),
        last_contact_date: el.last_contact_date ?? null,
        last_human_touch: el.last_human_touch ?? null,
        next_touch_due: el.next_touch_due ?? null,
        champion_contact_id: el.champion_contact_id ?? null,
        decision_maker_contact_id: el.decision_maker_contact_id ?? null,
        blocker_contact_id: el.blocker_contact_id ?? null,
        blocker_label: el.blocker_label ?? null,
        map_status: el.map_status ?? 'unknown',
        parent_company_id: el.parent_company_id ?? null,
      })) as any);

      setContacts(mContacts.map((el: any) => ({
        id: el.id,
        name: el.name,
        email: el.email,
        phone: el.phone,
        phone_second: el.phone_second,
        line: el.line,
        job_title: el.job_title,
        company_id: el.company_id,
        status: el.status,
        identity_quality: el.identity_quality ?? 'unknown',
        outreach_language: el.outreach_language ?? 'autodetect',
        outreach_language_basis: el.outreach_language_basis ?? 'autodetect',
        notes: el.notes,
        last_contacted_date: el.last_contacted_date,
        created_at: el.created_at || new Date().toISOString(),
        updated_at: el.updated_at || new Date().toISOString(),
      })) as any);

      setDeals(mDeals.map((el: any) => ({
        id: el.id,
        title: el.title,
        stage: el.stage,
        product: el.product,
        client: el.client,
        company_id: el.company_id,
        contact_ids: el.contact_ids || [],
        value: el.value,
        priority: el.priority,
        next_action: el.next_action,
        draft_primary_ask: el.draft_primary_ask || null,
        followup_date: el.followup_date,
        last_outcome: el.last_outcome,
        buyer_reply: el.buyer_reply ?? null,
        stated_order_kg: el.stated_order_kg ?? null,
        call_checklist: el.call_checklist ?? null,
        nudge_count: el.nudge_count || 0,
        workflow_action: el.workflow_action || undefined,
        nudge_stage: el.nudge_stage || null,
        sample_status: el.sample_status || null,
        lost_reason: el.lost_reason || null,
        park_reason: el.park_reason || null,
        won_note: el.won_note || null,
        created_at: el.created_at || new Date().toISOString(),
        updated_at: el.updated_at || new Date().toISOString(),
      })) as any);

      setMeetings(mMeetings.map((el: any) => ({
        id: el.id,
        description: el.description,
        type: el.type,
        date: el.date,
        company_id: el.company_id,
        contact_ids: el.contact_ids || [],
        deal_id: el.deal_id,
        product: el.product,
        summary: el.summary,
        outcome: el.outcome,
        followup_date: el.followup_date,
        direction: el.direction ?? null,
        created_at: el.created_at || new Date().toISOString(),
        updated_at: el.updated_at || new Date().toISOString(),
      })) as any);

      const dbEvents = ((eventsRes || []) as any[]).map((el: any) => ({
        id: el.id,
        timestamp: new Date(el.timestamp).getTime(),
        type: el.type,
        entity: el.entity,
        entityId: el.entity_id || undefined,
        label: el.label,
        description: el.description || undefined,
        undoPayload: el.undo_payload || undefined,
        applied: el.applied !== false,
      }));

      setActivities(prev => {
        // Keep in-flight local entries (temp ids) while swapping in DB-backed events.
        const pending = prev.filter(a => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(a.id));
        return [...pending, ...dbEvents];
      });

      setAccountEvents(acctEventsResult.data || []);
      setAccountEventsUnavailable(acctEventsResult.unavailable);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load CRM data');
    } finally {
      hasCompletedInitialLoad.current = true;
      if (showBlockingLoader) setLoading(false);
    }
  }, []);

  const logActivity = useCallback((entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => {
    const localId = Math.random().toString(36).slice(2, 9);
    const activity: ActivityEntry = {
      ...entry,
      id: localId,
      timestamp: Date.now(),
    };
    setActivities(prev => [activity, ...prev].slice(0, 500));
    // Persist to Supabase so the audit trail survives reloads.
    crm.createActivityEvent({
      type: entry.type,
      entity: entry.entity,
      entity_id: entry.entityId || null,
      label: entry.label,
      description: entry.description || null,
      undo_payload: entry.undoPayload || null,
    }).then((saved: any) => {
      savedIds.current.set(localId, saved.id);
      setActivities(prev => prev.map(a => a.id === localId ? { ...a, id: saved.id } : a));
    }).catch((err: any) => {
      console.error('Failed to persist activity event:', err);
    });
    return localId;
  }, []);

  const markActivityApplied = useCallback((id: string) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, applied: true } : a));
  }, []);

  const undoActivity = useCallback(async (requestedId: string) => {
    // Right after the save the entry may still carry its local id, or already the saved one.
    const id = savedIds.current.get(requestedId) ?? requestedId;
    const isEntry = (a: ActivityEntry) => a.id === id || a.id === requestedId;
    const activity = activitiesRef.current.find(isEntry);
    if (!activity?.undoPayload || activity.applied === false) return false;

    try {
      const table = TABLE_FOR[activity.entity];
      if (activity.type === 'merge') {
        // Undo a merge = move everything back and restore the archived account.
        await crm.unmergeCompanies(activity.undoPayload.merge_id);
      } else if (activity.type === 'delete') {
        // Undo a deletion = restore the archived row.
        await crm.restoreEntity(table, activity.entityId!);
      } else if (activity.type === 'create') {
        // Undo a creation = archive the just-created row.
        await crm.softDelete(table, activity.entityId!);
      } else if (activity.entity === 'deal' && activity.entityId) {
        await crm.updateDeal(activity.entityId, activity.undoPayload);
      } else if (activity.entity === 'company' && activity.entityId) {
        await crm.updateCompany(activity.entityId, activity.undoPayload);
      }
      setActivities(prev => prev.map(a => isEntry(a) ? { ...a, applied: false } : a));
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) {
        await crm.updateActivityEvent(id, { applied: false } as any).catch(() => {});
      }
      await refresh();
      return true;
    } catch (err) {
      console.error('Undo activity failed:', err);
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      refresh();
    }
  }, [refresh]);

  return (
    <CrmContext.Provider value={{
      companies,
      contacts,
      deals,
      meetings,
      accountEvents,
      accountEventsUnavailable,
      loading,
      error,
      refresh,
      addMeeting: async (meeting) => {
        const created = await crm.createMeeting(meeting) as Meeting;
        // Touch the linked contacts + company so last-touch dates stay honest
        // (feeds the "never contacted" radar and cold-account tracking).
        const touches: Promise<any>[] = [];
        (meeting.contact_ids || []).forEach(cid => {
          touches.push(crm.updateContact(cid, { last_contacted_date: meeting.date }).catch(() => null));
        });
        if (meeting.company_id) {
          touches.push(crm.updateCompany(meeting.company_id, { last_contact_date: meeting.date }).catch(() => null));
        }
        await Promise.all(touches);
        await refresh();
        return created;
      },
      createContact: async (contact) => {
        const created = await crm.createContact(contact);
        logActivity({
          type: 'create',
          entity: 'contact',
          entityId: (created as any).id,
          label: `Created contact · ${(created as any).name}`,
          undoPayload: { id: (created as any).id },
        });
        await refresh();
      },
      createCompany: async (company) => {
        const created = await crm.createCompany(company);
        logActivity({
          type: 'create',
          entity: 'company',
          entityId: (created as any).id,
          label: `Created company · ${(created as any).name}`,
          undoPayload: { id: (created as any).id },
        });
        await refresh();
        return created as Company;
      },
      createDeal: async (deal) => {
        const created = await crm.createDeal(deal);
        logActivity({
          type: 'create',
          entity: 'deal',
          entityId: (created as any).id,
          label: `Created deal · ${(created as any).client || (created as any).title}`,
          undoPayload: { id: (created as any).id },
        });
        await refresh();
      },
      deleteEntity: async (entity, id, label) => {
        await crm.softDelete(TABLE_FOR[entity], id);
        logActivity({
          type: 'delete',
          entity,
          entityId: id,
          label: `Archived ${entity} · ${label}`,
          undoPayload: { id },
        });
        await refresh();
      },
      restoreEntity: async (entity, id) => {
        await crm.restoreEntity(TABLE_FOR[entity], id);
        logActivity({
          type: 'restore',
          entity,
          entityId: id,
          label: `Restored ${entity}`,
          undoPayload: { id },
        });
        await refresh();
      },
      activities,
      logActivity,
      markActivityApplied,
      undoActivity,
    }}>
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  return useContext(CrmContext);
}
