import { redirect } from 'next/navigation';

// Finance opens on its first tab, Collections (DSH-04).
export default function FinancePage() {
  redirect('/app/finance/collections');
}
