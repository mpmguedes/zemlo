import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { daysBetween, type CalendarEntry, type CalendarResponse } from '@zemlo/shared';
import { Card, Chip, EmptyState } from '../ui/primitives';
import { dateLong, money, relativeDate, today } from '../lib/format';

/**
 * Calendário mensal (§21).
 *
 * Duas decisões que valem explicação:
 *
 *  1. **Projeções e compromissos são visualmente distintos.** Uma data projetada — a
 *     previsão de quando a revisão será atingida, calculada a partir do ritmo de
 *     quilometragem — é desenhada a **contorno**, e um compromisso confirmado é um ponto
 *     cheio. A grelha não pode sugerir que uma previsão é uma data marcada: quem lá chegasse
 *     e não houvesse nada seria enganado pelo próprio produto.
 *  2. **A grelha começa na segunda-feira.** A norma ISO 8601 e o hábito português são
 *     coincidentes; começar ao domingo (como faz o `date-fns` por omissão para o locale
 *     americano) deslocaria todos os fins de semana uma célula para a esquerda e tornaria a
 *     leitura de um mês mais lenta para quem sempre viu calendários com segunda à esquerda.
 */

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** Deslocamento da segunda-feira: `0` para segunda, `6` para domingo. */
function weekdayOffset(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (weekday + 6) % 7;
}

/** Dias de grelha para um mês, incluindo os dias de contexto do mês anterior e seguinte. */
function buildGrid(month: string): Array<{ date: string; inMonth: boolean }> {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const firstDay = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const leading = weekdayOffset(firstDay);
  const cells: Array<{ date: string; inMonth: boolean }> = [];

  for (let i = leading; i > 0; i -= 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, 1 - i));
    cells.push({ date: date.toISOString().slice(0, 10), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: `${month}-${String(day).padStart(2, '0')}`, inMonth: true });
  }
  // Completar a última semana: uma grelha de sete colunas com a última linha incompleta
  // desalinha os dias da semana.
  let trailing = 1;
  while (cells.length % 7 !== 0) {
    const date = new Date(Date.UTC(year, monthNumber, trailing));
    cells.push({ date: date.toISOString().slice(0, 10), inMonth: false });
    trailing += 1;
  }
  return cells;
}

export interface CalendarProps {
  /** Mês em `YYYY-MM`. */
  month: string;
  onMonthChange: (month: string) => void;
  data: CalendarResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function CalendarGrid({ month, onMonthChange, data, isLoading }: CalendarProps) {
  const reference = today();
  const [selected, setSelected] = useState<string | null>(null);
  const cells = useMemo(() => buildGrid(month), [month]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data?.entries ?? []) {
      const list = map.get(entry.date);
      if (list) list.push(entry);
      else map.set(entry.date, [entry]);
    }
    return map;
  }, [data]);

  const summaryByDay = useMemo(() => {
    const map = new Map<string, { count: number; hasOverdue: boolean }>();
    for (const day of data?.days ?? []) map.set(day.date, { count: day.count, hasOverdue: day.hasOverdue });
    return map;
  }, [data]);

  const monthLabel = dateLong(`${month}-01`).replace(/^1 de /, '').replace(/^1 /, '');
  const selectedEntries = selected ? entriesByDay.get(selected) ?? [] : [];

  function shiftMonth(delta: number) {
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const total = year * 12 + (monthNumber - 1) + delta;
    const nextYear = Math.floor(total / 12);
    const nextMonth = (total % 12) + 1;
    onMonthChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
  }

  return (
    <Card>
      <div className="z-card__header">
        <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
          <button type="button" className="z-icon-btn" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
            ‹
          </button>
          <span className="z-card__title" style={{ minWidth: '9ch', textAlign: 'center' }}>
            {monthLabel}
          </span>
          <button type="button" className="z-icon-btn" onClick={() => shiftMonth(1)} aria-label="Mês seguinte">
            ›
          </button>
        </div>
        <button type="button" className="z-btn z-btn--ghost z-btn--sm" onClick={() => onMonthChange(reference.slice(0, 7))}>
          Hoje
        </button>
      </div>

      {isLoading ? (
        <p className="z-small z-muted" role="status">
          A carregar o mês…
        </p>
      ) : null}

      <div className="z-calendar__weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span className="z-calendar__weekday" key={day}>
            {day}
          </span>
        ))}
      </div>

      <div className="z-calendar__grid" role="grid" aria-label={`Calendário de ${monthLabel}`}>
        {cells.map((cell) => {
          const summary = summaryByDay.get(cell.date);
          const entries = entriesByDay.get(cell.date) ?? [];
          const isToday = cell.date === reference;
          const isSelected = cell.date === selected;
          const dayNumber = Number(cell.date.slice(8, 10));
          const classes = [
            'z-calendar__day',
            !cell.inMonth ? 'z-calendar__day--outside' : '',
            isToday ? 'z-calendar__day--today' : '',
            isSelected ? 'z-calendar__day--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              type="button"
              key={cell.date}
              className={classes}
              aria-pressed={isSelected}
              aria-label={`${dateLong(cell.date)}${summary ? `, ${summary.count} ${summary.count === 1 ? 'entrada' : 'entradas'}` : ', sem entradas'}`}
              onClick={() => setSelected(isSelected ? null : cell.date)}
            >
              <span className="z-numeric">{dayNumber}</span>
              {entries.length > 0 ? (
                <span className="z-calendar__markers">
                  {/* Projeções a contorno, compromissos cheios; atrasos em cor de alerta. */}
                  {entries.slice(0, 3).map((entry) => (
                    <span
                      key={entry.id}
                      className={[
                        'z-calendar__marker',
                        entry.projected ? 'z-calendar__marker--projected' : '',
                        entry.state === 'overdue' ? 'z-calendar__marker--overdue' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    />
                  ))}
                  {entries.length > 3 ? <span className="z-calendar__day-count">+{entries.length - 3}</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="z-calendar__legend" style={{ marginTop: 'var(--z-space-3)' }}>
        <span className="z-bars__legend-item">
          <span className="z-calendar__marker" aria-hidden="true" />
          Data marcada
        </span>
        <span className="z-bars__legend-item">
          <span className="z-calendar__marker z-calendar__marker--projected" aria-hidden="true" />
          Data prevista (estimativa com base no teu ritmo)
        </span>
        <span className="z-bars__legend-item">
          <span className="z-calendar__marker z-calendar__marker--overdue" aria-hidden="true" />
          Em atraso
        </span>
      </div>

      {selected ? (
        <div className="z-stack" style={{ marginTop: 'var(--z-space-4)' }}>
          <h3 style={{ fontSize: 'var(--z-text-md)' }}>
            {dateLong(selected)}
            <span className="z-xs z-muted"> · {relativeDate(selected)}</span>
          </h3>
          {selectedEntries.length === 0 ? (
            <p className="z-small z-muted">Nada marcado neste dia.</p>
          ) : (
            <div className="z-list z-card z-card--flush">
              {selectedEntries.map((entry) => {
                const content = (
                  <>
                    <span className="z-list__icon" aria-hidden="true">
                      {entry.icon}
                    </span>
                    <span className="z-list__body">
                      <span className="z-list__title">{entry.title}</span>
                      <span className="z-list__meta">
                        {entry.vehiclePlateDisplay}
                        {entry.subtitle ? ` · ${entry.subtitle}` : ''}
                        {entry.projected ? ' · previsto' : ''}
                      </span>
                    </span>
                    {entry.amountCents !== null ? (
                      <span className="z-list__trailing z-numeric">{money(entry.amountCents)}</span>
                    ) : null}
                  </>
                );
                return entry.href ? (
                  <Link key={entry.id} to={entry.href} className="z-list__item">
                    {content}
                  </Link>
                ) : (
                  <div key={entry.id} className="z-list__item">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
          Toca num dia para veres o que lá está.
        </p>
      )}

      {!isLoading && (data?.entries.length ?? 0) === 0 ? (
        <EmptyState
          icon="🗓️"
          title="Nada marcado neste mês"
          body="O calendário junta prazos de seguro, inspeção, impostos, documentos e manutenções — confirmados e previstos. À medida que registares, os meses ficam preenchidos."
        />
      ) : null}
    </Card>
  );
}

/**
 * Marcos temporais: quantos dias faltam para o que está marcado a seguir.
 *
 * Fica ao lado do calendário porque responde à pergunta que a grelha não responde bem:
 * "o que é que tenho de tratar primeiro?".
 */
export function UpcomingList({ entries, limit = 5 }: { entries: CalendarEntry[]; limit?: number }) {
  const reference = today();
  const upcoming = entries
    .filter((entry) => daysBetween(reference, entry.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);

  if (upcoming.length === 0) {
    return (
      <p className="z-small z-muted">
        Sem prazos à frente. Quando houver, aparecem aqui por ordem de proximidade.
      </p>
    );
  }

  return (
    <div className="z-list z-card z-card--flush">
      {upcoming.map((entry) => {
        const content = (
          <>
            <span className="z-list__icon" aria-hidden="true">
              {entry.icon}
            </span>
            <span className="z-list__body">
              <span className="z-list__title">{entry.title}</span>
              <span className="z-list__meta">
                {dateLong(entry.date)} · {entry.vehiclePlateDisplay}
              </span>
            </span>
            <span className="z-list__trailing">
              <Chip tone={entry.state === 'overdue' ? 'danger' : entry.state === 'soon' ? 'warn' : 'neutral'}>
                {relativeDate(entry.date, reference)}
              </Chip>
            </span>
          </>
        );
        return entry.href ? (
          <Link key={entry.id} to={entry.href} className="z-list__item">
            {content}
          </Link>
        ) : (
          <div key={entry.id} className="z-list__item">
            {content}
          </div>
        );
      })}
    </div>
  );
}
