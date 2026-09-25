import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { REMINDER_TRIGGERS, formatNumber, optionLabel, type ReminderState } from '@zemlo/shared';
import {
  useCompleteReminder,
  useCreateReminder,
  useDeleteReminder,
  useOdometerReadings,
  useProfile,
  useReminders,
  useSnoozeReminder,
} from '../../api/hooks';
import { useSelectedVehicle } from '../../hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { ApiError } from '../../api/client';
import { Button, Card, Chip, DetailList, DetailRow, InlineError, LoadingBlock, PageHeader } from '../../ui/primitives';
import { CheckboxField, DateField, NumberField, SelectField, TextAreaField, TextField, useFormState } from '../../ui/form';
import { LocalSearch } from '../../ui/LocalSearch';
import { useToast } from '../../ui/Toaster';
import { filterByQuery, searchScopeNote } from '../../lib/localSearch';
import { dateLong, km, relativeDate, today } from '../../lib/format';
import { integerOrUndefined, textOrUndefined } from '../../lib/formPayload';

/**
 * Lembretes (§16).
 *
 * O estado de um lembrete **nunca é guardado**: é calculado a cada pedido a partir de hoje e
 * da quilometragem atual. Isso significa que este ecrã não pode gerir estado de estado — não
 * há nada para atualizar além do próprio lembrete, e "em atraso" é uma conclusão que a API
 * tira no momento em que responde. É por isso que a lista é invalidada, e não corrigida à
 * mão, depois de cada ação.
 *
 * Duas ações merecem explicação:
 *
 *  - **Concluir** envia `createNext: true` e a data de conclusão de hoje: uma revisão
 *    anual feita oito meses atrasada cria a ocorrência seguinte contada a partir de *hoje*,
 *    não da data que falhou. Sem isto, a próxima revisão nasceria já em atraso e o Zemlo
 *    estaria permanentemente a acusar o utilizador de um atraso que ele já resolveu.
 *  - **Adiar 14 dias** é a válvula de escape que evita que um utilizador desligue os avisos
 *    por completo. Adiar é uma decisão informada; desligar é uma perda de informação.
 */
export function RemindersPage() {
  const { vehicleId, vehicles } = useSelectedVehicle();
  const [state, setState] = useState<string>('');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [query, setQuery] = useState('');

  const selectedVehicleId = vehicleId === 'all' ? vehicles[0]?.id : vehicleId;
  const reminders = useReminders({
    vehicleId: selectedVehicleId,
    // O filtro por estado é opcional no contrato (`zReminderListQuery.state`); a chave de
    // consulta já o inclui, pelo que mudar de filtro é uma consulta nova e não um reaproveitamento.
    ...(state ? { state: state as ReminderState } : {}),
    includeCompleted,
  });

  const complete = useCompleteReminder();
  const snooze = useSnoozeReminder();
  const remove = useDeleteReminder();
  const create = useCreateReminder();
  const odometer = useOdometerReadings(selectedVehicleId);
  const profile = useProfile();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const form = useFormState({
    title: '',
    trigger: 'both',
    dueDate: today(),
    dueOdometerKm: '',
    intervalKm: '',
    intervalMonths: '',
    repeat: 'true',
    notes: '',
  });

  const latestOdometer = odometer.data?.items[0]?.odometerKm ?? null;

  /*
   * Pesquisa local (`WEB-007`) sobre os lembretes já carregados. O `state` e o
   * `includeCompleted` são filtros **de servidor** (vivem na chave da consulta, ver acima) —
   * a pesquisa é o único filtro local deste ecrã, e por isso conta sobre o que o servidor já
   * devolveu.
   *
   * `loadedItems` é o universo real: o que a consulta atualmente carregou, já filtrado por
   * estado no servidor. A nota de âmbito diz «todos», porque este ecrã carrega a resposta
   * inteira (não pagina por cursor).
   */
  const loadedItems = reminders.data?.items ?? [];
  const items = filterByQuery(loadedItems, query, (reminder) => [
    reminder.title,
    optionLabel(REMINDER_TRIGGERS, reminder.trigger),
    reminder.notes,
  ]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedVehicleId) return;
    setErrors({});

    const payload: Record<string, unknown> = {
      vehicleId: selectedVehicleId,
      title: form.values.title,
      trigger: form.values.trigger,
      repeat: form.values.repeat === 'true',
    };
    const dueDate = textOrUndefined(form.values.dueDate);
    if (dueDate && form.values.trigger !== 'distance') payload.dueDate = dueDate;
    const dueOdometerKm = integerOrUndefined(form.values.dueOdometerKm);
    if (dueOdometerKm !== undefined && form.values.trigger !== 'time') payload.dueOdometerKm = dueOdometerKm;
    const intervalKm = integerOrUndefined(form.values.intervalKm);
    if (intervalKm !== undefined) payload.intervalKm = intervalKm;
    const intervalMonths = integerOrUndefined(form.values.intervalMonths);
    if (intervalMonths !== undefined) payload.intervalMonths = intervalMonths;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
      toast.show('Lembrete criado.', { variant: 'ok' });
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  if (!selectedVehicleId) {
    return (
      <div className="z-page">
        <PageHeader title="Lembretes" subtitle="Prazos que o Zemlo vigia por ti." />
        <Card>
          <p className="z-small">
            Os lembretes pertencem a um veículo. <Link to="/vehicles/new">Adiciona o primeiro veículo</Link> para
            começares a marcar prazos.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Lembretes"
        subtitle="Revisões, seguros, inspeções e IUC — com aviso antes do prazo."
        actions={
          <Button variant="highlight" onClick={() => setShowForm((value) => !value)}>
            ＋ Novo lembrete
          </Button>
        }
      />

      {reminders.data ? (
        /*
         * `role="group"` + `aria-label` (uniformização de `WEB-007`): sem nome, um leitor de
         * ecrã anuncia sete botões de filtro soltos. A guarda de `WEB-006` em
         * `accessibility.test.tsx` passa a apanhar este grupo — antes não o via porque não
         * tinha `role="group"`.
         */
        <div className="z-filters" role="group" aria-label="Filtrar lembretes por estado">
          <Chip tone={state === '' ? 'accent' : 'neutral'}>
            <button type="button" onClick={() => setState('')} style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}>
              Todos ({formatNumber(reminders.data.total, 0)})
            </button>
          </Chip>
          {(['overdue', 'due', 'soon', 'ok', 'unknown'] as const).map((candidate) => (
            <Chip key={candidate} tone={state === candidate ? 'accent' : 'neutral'}>
              <button
                type="button"
                onClick={() => setState(candidate)}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                {candidate === 'overdue' ? 'Em atraso' : candidate === 'due' ? 'A vencer' : candidate === 'soon' ? 'Em breve' : candidate === 'ok' ? 'Em dia' : 'Sem dados'} (
                {formatNumber(reminders.data.counts[candidate], 0)})
              </button>
            </Chip>
          ))}
          <Chip tone={includeCompleted ? 'accent' : 'neutral'}>
            <button
              type="button"
              onClick={() => setIncludeCompleted((value) => !value)}
              style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
            >
              {includeCompleted ? '✓ ' : ''}Incluir concluídos
            </button>
          </Chip>
        </div>
      ) : null}

      {/*
        A pesquisa é local e vive **fora** do `z-filters`: o filtro de estado é do servidor
        (muda a consulta), a pesquisa é do cliente (filtra o que já veio). Aparece sempre que
        há lembretes carregados, para continuar visível mesmo quando a pesquisa esvazia a lista
        — é o único caminho de volta.
      */}
      {reminders.data && loadedItems.length > 0 ? (
        <LocalSearch
          value={query}
          onChange={setQuery}
          label="Pesquisar lembretes"
          placeholder="Título, gatilho, notas…"
          scopeNote={searchScopeNote(loadedItems.length, reminders.data.total)}
          matched={items.length}
          loaded={loadedItems.length}
        />
      ) : null}

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Novo lembrete</div>
              <div className="z-card__subtitle">
                Com «km ou tempo», o aviso chega quando qualquer das condições for atingida — o
                comportamento correto para uma revisão.
              </div>
            </div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <TextField
              label="Título"
              required
              autoFocus
              placeholder="Revisão dos 50 000 km"
              value={form.values.title}
              onChange={(event) => form.setValue('title', event.target.value)}
              error={errors.title}
            />
            <SelectField
              label="Dispara por"
              value={form.values.trigger}
              onChange={(event) => form.setValue('trigger', event.target.value)}
              options={REMINDER_TRIGGERS.map((trigger) => ({ value: trigger.code, label: trigger.label }))}
              error={errors.trigger}
            />
            <div className="z-grid z-grid--2">
              <DateField
                label="Data limite"
                disabled={form.values.trigger === 'distance'}
                value={form.values.dueDate}
                onChange={(event) => form.setValue('dueDate', event.target.value)}
                error={errors.dueDate}
              />
              <NumberField
                label="Quilometragem limite"
                suffix="km"
                disabled={form.values.trigger === 'time'}
                hint={latestOdometer !== null ? `Última leitura: ${km(latestOdometer)}` : 'Sem leitura registada.'}
                value={form.values.dueOdometerKm}
                onChange={(value) => form.setValue('dueOdometerKm', value)}
                error={errors.dueOdometerKm}
              />
            </div>
            <div className="z-grid z-grid--2">
              <NumberField label="Repetir a cada" suffix="km" value={form.values.intervalKm} onChange={(value) => form.setValue('intervalKm', value)} error={errors.intervalKm} />
              <NumberField label="Repetir a cada" suffix="meses" value={form.values.intervalMonths} onChange={(value) => form.setValue('intervalMonths', value)} error={errors.intervalMonths} />
            </div>
            <CheckboxField
              label="Repetir automaticamente"
              checked={form.values.repeat === 'true'}
              onChange={(checked) => form.setValue('repeat', checked ? 'true' : 'false')}
              hint="Ao concluir, cria a ocorrência seguinte contada a partir da data de conclusão — uma revisão feita oito meses atrasada não nasce já em atraso."
            />
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Criar lembrete</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {reminders.isLoading ? <LoadingBlock label="A avaliar lembretes…" /> : null}

      {reminders.isError ? (
        <InlineError
          message={errorMessage(reminders.error)}
          requestId={errorRequestId(reminders.error)}
          onRetry={() => void reminders.refetch()}
        />
      ) : null}

      {reminders.data && items.length === 0 ? (
        <Card>
          <div className="z-empty">
            <span className="z-empty__icon" aria-hidden="true">🔔</span>
            <p className="z-empty__title">
              {query.trim() !== ''
                ? 'Nada corresponde à pesquisa'
                : state || includeCompleted
                  ? 'Nada neste filtro'
                  : 'Sem lembretes ativos'}
            </p>
            <p className="z-empty__body">
              {query.trim() !== ''
                ? `A pesquisa por «${query.trim()}» não encontrou lembretes nesta lista. A pesquisa atua apenas sobre os ${loadedItems.length} lembretes já carregados.`
                : state || includeCompleted
                  ? 'Nenhum lembrete corresponde ao filtro escolhido. Limpa o filtro para ver todos.'
                  : 'Os lembretes são o que faz o Zemlo avisar-te em vez de esperar que te lembres. Uma revisão a cada 10 000 km ou um ano é o exemplo mais comum.'}
            </p>
            {!state && !includeCompleted && query.trim() === '' ? (
              <Button variant="primary" onClick={() => setShowForm(true)}>
                Criar o primeiro lembrete
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {items.map((reminder) => (
        <Card key={reminder.id}>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">{reminder.title}</div>
              <div className="z-card__subtitle">
                {optionLabel(REMINDER_TRIGGERS, reminder.trigger)}
                {reminder.repeat ? ' · repete automaticamente' : ''}
                {reminder.completedAt ? ` · concluído em ${dateLong(reminder.completedAt.slice(0, 10))}` : ''}
              </div>
            </div>
            <Chip
              tone={
                reminder.evaluation.state === 'overdue'
                  ? 'danger'
                  : reminder.evaluation.state === 'ok'
                    ? 'ok'
                    : 'warn'
              }
            >
              {reminder.evaluation.summary}
            </Chip>
          </div>

          <DetailList>
            {reminder.dueDate ? (
              <DetailRow label="Data limite" value={`${dateLong(reminder.dueDate)} · ${relativeDate(reminder.dueDate)}`} />
            ) : null}
            {reminder.dueOdometerKm !== null ? <DetailRow label="Quilometragem" value={km(reminder.dueOdometerKm)} /> : null}
            {reminder.evaluation.projectedDate ? (
              <DetailRow
                label="Data prevista"
                value={`${dateLong(reminder.evaluation.projectedDate)} — estimativa a partir do teu ritmo de utilização`}
              />
            ) : null}
            {reminder.intervalKm !== null ? <DetailRow label="Repete a cada" value={km(reminder.intervalKm)} /> : null}
            {reminder.intervalMonths !== null ? <DetailRow label="Repete a cada" value={`${reminder.intervalMonths} meses`} /> : null}
          </DetailList>

          {reminder.notes ? <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>{reminder.notes}</p> : null}

          <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-3)' }}>
            <Button
              variant="primary"
              size="sm"
              loading={complete.isPending}
              onClick={() =>
                void complete.mutateAsync({
                  reminderId: reminder.id,
                  payload: {
                    createNext: true,
                    ...(latestOdometer !== null ? { odometerKm: latestOdometer } : {}),
                  },
                })
              }
            >
              Concluir
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={snooze.isPending}
              onClick={() => void snooze.mutateAsync({ reminderId: reminder.id, days: 14 })}
            >
              Adiar 14 dias
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Eliminar este lembrete? Os registos já feitos não são afetados.')) {
                  void remove.mutateAsync(reminder.id);
                }
              }}
            >
              Eliminar
            </Button>
          </div>
        </Card>
      ))}

      <p className="z-xs z-muted">
        O estado de cada lembrete é recalculado a cada consulta, a partir de hoje e da tua
        quilometragem — nunca é guardado. Se uma data aparecer como «prevista», é porque só
        existe a condição de quilometragem e o Zemlo usou o teu ritmo para estimar quando ela
        chega. {profile.data ? `Fuso horário: ${profile.data.timeZone}.` : ''}
      </p>
    </div>
  );
}
