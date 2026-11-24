import React from 'react';
import FunnelAnalyticsDashboard from '../components/FunnelAnalyticsDashboard';

export default function AnnualFunnelPage() {
  return <FunnelAnalyticsDashboard defaultPeriod="annual" defaultPreset="this_year" />;
}
