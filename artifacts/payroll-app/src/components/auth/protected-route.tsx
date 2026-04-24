import React from "react";
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";

export const ProtectedRoute: React.FC<{ component: React.ComponentType<any>, path: string }> = ({ component: Component, path }) => {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  // ドライバー画面は例外的に保護しない（個別PIN認証があるため）
  if (path.startsWith("/driver/")) {
    return <Component />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <Component />;
};
