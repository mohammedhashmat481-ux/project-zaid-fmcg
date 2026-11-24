import React from 'react';
import FunnelAnalyticsDashboard from '../components/FunnelAnalyticsDashboard';

export default function MonthlyFunnelPage() {
  return <FunnelAnalyticsDashboard defaultPeriod="monthly" defaultPreset="this_month" />;
}
