import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';

export function MainLayout({ children }: { children: ReactNode }) {
  const collapsed = useFilterStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <div
        className={cn(
          'flex flex-1 flex-col min-w-0 transition-[margin] duration-200',
          collapsed ? 'ml-[60px]' : 'ml-[260px]',
        )}
      >
        <TopBar />
        <main className="flex-1 overflow-y-auto px-5 py-4">{children}</main>
      </div>
    </div>
  );
}
