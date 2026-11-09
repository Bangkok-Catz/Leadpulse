import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Company } from '@/types/crm';

const crm = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/components/CrmProvider', () => ({ useCrm: () => crm.value }));
const toast = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('@/components/CompanyLogo', () => ({ default: () => null }));
vi.mock('@/utils/useBusinessDateKey', () => ({ useBusinessDateKey: () => '2026-10-21' }));
const MONTHS = [
  { month: '2026-07-01', amount: 40020, orders: 10, buyers: 8 },
  { month: '2026-08-01', amount: 29406, orders: 10, buyers: 8 },
  { month: '2026-10-01', amount: 1900, orders: 1, buyers: 1 },
];
const db = vi.hoisted(() => ({
  months: [] as { month: string; amount: number; orders: number; buyers: number }[],
  latest: '2026-08-22' as string | null,
  preview: [] as unknown[],
  importInvoices: vi.fn(async () => ({ added: 2, already_in: 1, new_customers: 1 })),
}));
vi.mock('@/lib/sales', () => ({
  getSalesByMonth: async () => db.months,
  getLatestInvoiceDate: async () => db.latest,
  getCustomerRhythms: async () => [
    { customer_id: 'hl', name_en: 'Healthy Lux Co., Ltd. (Head Office)', name_th: null, crm_company_id: 'c-hl', order_count: 73, first_order: '2023-08-30', last_order: '2026-10-10', median_gap_days: 14, median_value: 2042 },
    { customer_id: 'vistro', name_en: 'Vistro Co., Ltd.', name_th: null, crm_company_id: null, order_count: 31, first_order: '2023-01-01', last_order: '2026-08-11', median_gap_days: 40, median_value: 5619 },
    { customer_id: 'ohtl', name_en: 'OHTL Public Company Limited', name_th: null, crm_company_id: null, order_count: 25, first_order: '2023-01-01', last_order: '2025-10-10', median_gap_days: 32, median_value: 2930 },
    { customer_id: 'once', name_en: 'Once Co., Ltd.', name_th: null, crm_company_id: null, order_count: 1, first_order: '2026-09-01', last_order: '2026-09-01', median_gap_days: null, median_value: 500 },
  ],
  previewInvoiceImport: async () => db.preview,
  importInvoices: db.importInvoices,
}));

import SalesPage from './page';

db.months = MONTHS;
afterEach(() => { cleanup(); db.latest = '2026-08-22'; db.months = MONTHS; db.importInvoices.mockClear(); toast.addToast.mockClear(); });

const company = (id: string, name: string): Company => ({ id, name, status: 'active_customer', tags: [], logo_url: null } as unknown as Company);
const refresh = vi.fn(async () => {});
crm.value = { companies: [company('c-hl', 'Healthy Lux'), company('c-mia', 'Mia Restaurant')], refresh };

const REPORT = [
  'ลำดับที่,เลขที่เอกสาร,วัน/เดือน/ปี,ชื่อลูกค้า,สกุลเงินในเอกสาร,อัตราแลกเปลี่ยน,ยอดรวมสุทธิ',
  '1,INV2026090001,05/09/2026,บริษัท เฮลตี้ ลักซ์ จำกัด (สำนักงานใหญ่),THB,1.00,"1,950.50"',
  '2,INV2026090002,06/09/2026,"Mia Restaurant Co., Ltd.",THB,1.00,"2,200.00"',
  '3,INV2026080009,22/08/2026,"Mia Restaurant Co., Ltd.",THB,1.00,"2,200.00"',
].join('\n');

describe('Sales page', () => {
  it('shows the month, regulars by status, quiet customers, and asks for an import when invoices are old', async () => {
    render(<SalesPage />);
    expect(await screen.findByText('฿1,900')).toBeTruthy();
    expect(screen.getByText('1 order · 1 buyer')).toBeTruthy();
    expect(screen.getByText(/Invoices are in up to 22 Aug/)).toBeTruthy();

    const regulars = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(regulars).toEqual(['Regulars', 'Gone quiet']);
    // Vistro (every ~40 days, last 11 Aug) is late and listed first; Healthy Lux is on track and opens its account.
    const vistro = screen.getByText('Vistro').closest('div')!;
    expect(within(vistro.parentElement as HTMLElement).getByText(/late · 20 Sep/)).toBeTruthy();
    expect(screen.getByText('Healthy Lux').closest('a')?.getAttribute('href')).toBe('/companies?company=c-hl');
    expect(screen.getByText(/next · 24 Oct/)).toBeTruthy();
    expect(screen.getByText('OHTL')).toBeTruthy();
    expect(screen.queryByText('Once')).toBeNull();
  });

  it('leads with the month against a usual month, the best month and how regulars stand', async () => {
    render(<SalesPage />);
    const board = await screen.findByTestId('sales-board');
    expect(within(board).getByText('October so far')).toBeTruthy();
    expect(within(board).getByText('5% of a usual month · ฿32,813 to go')).toBeTruthy();
    expect(within(board).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5');
    expect(within(board).getByText('1 late')).toBeTruthy();
    expect(within(board).getByText('1 on track')).toBeTruthy();
    expect(within(board).getByText('1 gone quiet')).toBeTruthy();
    expect(screen.getByText(/Best month:/).parentElement?.textContent).toBe('Best month: Jul 2026 ฿40,020');
  });

  it('says when the month has passed a usual one', async () => {
    db.months = [...MONTHS.slice(0, 2), { month: '2026-10-01', amount: 36000, orders: 9, buyers: 6 }];
    render(<SalesPage />);
    expect(await screen.findByText('Above a usual month')).toBeTruthy();
  });

  it('hides the import reminder when invoices are recent', async () => {
    db.latest = '2026-10-15';
    render(<SalesPage />);
    await screen.findByRole('heading', { name: 'Regulars' });
    expect(screen.queryByText(/Invoices are in up to/)).toBeNull();
  });

  it('imports a FlowAccount file: skips what is in and links a customer to the account picked', async () => {
    db.preview = [
      { document_no: 'INV2026090001', already_in: false, customer_id: 'hl', customer_name: 'Healthy Lux', crm_company_id: 'c-hl' },
      { document_no: 'INV2026090002', already_in: false, customer_id: 'mia', customer_name: 'Mia', crm_company_id: null },
      { document_no: 'INV2026080009', already_in: true, customer_id: 'mia', customer_name: 'Mia', crm_company_id: null },
    ];
    const { container } = render(<SalesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Import from FlowAccount/ }));
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([REPORT], 'sales.csv', { type: 'text/csv' })] } });

    expect(await screen.findByText('2 new invoices')).toBeTruthy();
    expect(screen.getByText(/1 already in/)).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('c-mia'); // suggested by name

    // The import brings in two September orders.
    db.months = [...MONTHS.slice(0, 2), { month: '2026-09-01', amount: 4150.5, orders: 2, buyers: 2 }, MONTHS[2]];
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 invoices' }));
    await waitFor(() => expect(db.importInvoices).toHaveBeenCalled());
    await waitFor(() => expect(toast.addToast).toHaveBeenCalledWith('+฿4,151 invoiced · 2 orders'));
    const [rows] = db.importInvoices.mock.calls[0] as unknown as [Array<{ document_no: string; crm_company_id: string | null }>];
    expect(rows.map((r) => [r.document_no, r.crm_company_id])).toEqual([['INV2026090001', null], ['INV2026090002', 'c-mia']]);
    await waitFor(() => expect(toast.addToast).toHaveBeenCalledWith('Added 2 invoices'));
    expect(refresh).toHaveBeenCalled();
  });
});
