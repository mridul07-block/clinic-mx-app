import { redirect } from 'next/navigation';

// Reports opens on its first tab, Centres.
export default function ReportsPage() {
  redirect('/app/dashboard/centres');
}
