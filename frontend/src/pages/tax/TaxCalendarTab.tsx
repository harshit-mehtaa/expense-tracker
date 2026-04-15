import { Calendar, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdvanceTaxEvent {
  id: string;
  fyYear: string;
  dueDate: string;
  percentageDue: number;
  description: string;
  isSystemGenerated?: boolean;
}

type EventType = 'advance-tax' | 'filing' | 'form';

interface CalendarEvent {
  id: string;
  date: Date;
  title: string;
  description: string;
  type: EventType;
  badge: string;
  percentageDue?: number;
}

interface TaxCalendarTabProps {
  fyYear: string;
  advanceTax: AdvanceTaxEvent[];
}

export default function TaxCalendarTab({ fyYear, advanceTax }: TaxCalendarTabProps) {
  // FY string like "2025-26" → startYear=2025, endYear=2026
  const startYear = parseInt(fyYear.split('-')[0], 10);
  const endYear = startYear + 1;

  // Static ITR deadlines — these are statutory dates and may be extended by CBDT notification.
  // Always verify the current deadline at incometax.gov.in before filing.
  const staticEvents: CalendarEvent[] = [
    {
      id: 'form16',
      date: new Date(`${endYear}-06-15`),
      title: 'Form 16 Availability',
      description: 'Employer must issue Form 16 (TDS certificate for salary income) by this date.',
      type: 'form',
      badge: 'Form 16',
    },
    {
      id: 'itr-filing',
      date: new Date(`${endYear}-07-31`),
      title: 'ITR Filing Deadline',
      description: `Original deadline to file ITR for FY ${fyYear} without late fee (non-audit cases). CBDT may extend this — check incometax.gov.in.`,
      type: 'filing',
      badge: 'ITR Deadline',
    },
    {
      id: 'revised-belated',
      date: new Date(`${endYear}-12-31`),
      title: 'Revised / Belated Return Deadline',
      description: `Last date to file a belated return (if the original deadline was missed) or revise an already-filed return for FY ${fyYear}.`,
      type: 'filing',
      badge: 'Revised / Belated',
    },
  ];

  const advanceTaxEvents: CalendarEvent[] = advanceTax.map((e) => ({
    id: e.id,
    date: new Date(e.dueDate),
    title: e.description,
    description: `Pay ${e.percentageDue}% of estimated annual tax liability by this date. Interest under Sec 234B/234C applies on shortfall.`,
    type: 'advance-tax',
    badge: 'Advance Tax',
    percentageDue: e.percentageDue,
  }));

  const allEvents: CalendarEvent[] = [...staticEvents, ...advanceTaxEvents]
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const badgeColors: Record<EventType, string> = {
    'advance-tax': 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300',
    'filing': 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300',
    'form': 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Key tax dates for FY {fyYear}. Advance tax installment percentages are standard schedules (15% / 45% / 75% / 100%).
        Filing deadlines are statutory — check <strong>incometax.gov.in</strong> for any CBDT extensions before filing.
      </p>

      <div className="space-y-3">
        {allEvents.map((event) => {
          const isPast = event.date < today;
          const daysLeft = isPast ? 0 : Math.ceil((event.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const isUrgent = !isPast && daysLeft <= 30;

          return (
            <div
              key={event.id}
              className={cn(
                'rounded-lg border p-4 space-y-2 transition-colors',
                isPast
                  ? 'border-muted opacity-60 bg-muted/10'
                  : isUrgent
                    ? 'border-orange-400 bg-orange-50 dark:bg-orange-950'
                    : 'bg-card',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
                    badgeColors[event.type],
                  )}>
                    {event.badge}
                  </span>
                  <h3 className="font-medium text-sm">{event.title}</h3>
                </div>
                <div className="flex items-center gap-1.5 text-xs shrink-0">
                  {isPast ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle className="h-3.5 w-3.5" /> Past
                    </span>
                  ) : isUrgent ? (
                    <span className="flex items-center gap-1 text-orange-600 font-medium">
                      <AlertCircle className="h-3.5 w-3.5" /> {daysLeft}d left
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> {daysLeft}d
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {event.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>

              <p className="text-xs text-muted-foreground">{event.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
