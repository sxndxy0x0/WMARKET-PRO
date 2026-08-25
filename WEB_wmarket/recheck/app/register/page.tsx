import { redirect } from 'next/navigation';

// No separate registration flow anymore — Google Sign-In (see /login)
// creates the account automatically on first sign-in. This route just
// catches anyone who still has the old /register link bookmarked.
export default function RegisterRedirect() {
  redirect('/login');
}
