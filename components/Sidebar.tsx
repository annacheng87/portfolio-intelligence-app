import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="h-screen w-64 bg-slate-900 p-4 text-white">
      <ul className="space-y-4">
        <li><Link href="/dashboard">Dashboard</Link></li>
        <li><Link href="/alerts">Alerts</Link></li>
        <li><Link href="/leaderboard">Leaderboard</Link></li>
      </ul>
    </aside>
  );
}