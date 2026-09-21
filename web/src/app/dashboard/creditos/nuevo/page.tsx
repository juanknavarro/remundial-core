import { redirect } from 'next/navigation';

export default function RedirectToPOSPage() {
  redirect('/dashboard/pos');
}
