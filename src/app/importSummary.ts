import type { BatchResult } from '../converter/convertBatch';

type Activity = BatchResult['activities'][number];

export interface ImportSummary { exerciseTypes: number; yearsCovered: number }

export function summarizeActivities(activities: Activity[]): ImportSummary {
  const exerciseTypes = new Set(activities.map((activity) => activity.type)).size;
  const yearsCovered = new Set(activities.flatMap((activity) => activity.start ? [activity.start.getUTCFullYear()] : [])).size;
  return { exerciseTypes, yearsCovered };
}
