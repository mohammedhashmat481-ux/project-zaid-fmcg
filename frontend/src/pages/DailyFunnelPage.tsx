import React from 'react';
import FunnelAnalyticsDashboard from '../components/FunnelAnalyticsDashboard';

export default function DailyFunnelPage() {
  return <FunnelAnalyticsDashboard defaultPeriod="daily" defaultPreset="today" />;
}
