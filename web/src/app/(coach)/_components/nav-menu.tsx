"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Dumbbell, ClipboardList } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Дашборд", icon: <LayoutDashboard /> },
  { href: "/clients", label: "Клиенты", icon: <Users /> },
  { href: "/programs", label: "Программы", icon: <Dumbbell /> },
  { href: "/exercises", label: "Упражнения", icon: <ClipboardList />, adminOnly: true },
];

export function NavMenu({ role }: { role?: string | null }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="Основное меню">
      {NAV_ITEMS.filter(
        (item) => !item.adminOnly || role == null || role === "admin" || role === "coach",
      ).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: active ? "default" : "ghost", size: "sm" }),
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}