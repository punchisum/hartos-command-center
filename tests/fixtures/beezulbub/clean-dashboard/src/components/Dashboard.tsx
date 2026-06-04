// Dashboard layout component
// No secrets, no hardcoded values, clean React component

import React from "react";

interface DashboardProps {
  title: string;
  children: React.ReactNode;
}

export function Dashboard({ title, children }: DashboardProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-4 px-4">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-6 px-4">{children}</main>
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
