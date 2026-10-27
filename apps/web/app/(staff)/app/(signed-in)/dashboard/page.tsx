import { redirect } from 'next/navigation';

// The dashboard opens on its first tab, Alerts (DSH-03).
export default function DashboardPage() {
  redirect('/app/dashboard/alerts');
}
