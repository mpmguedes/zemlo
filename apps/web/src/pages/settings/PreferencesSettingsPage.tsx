import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EXPENSE_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_TOPICS,
  formatNumber,
} from '@zemlo/shared';
import { usePreferences, useUpdatePreferences } from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { Button, Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../../ui/primitives';
import { NumberField } from '../../ui/form';
import { useToast } from '../../ui/Toaster';

/**
 * Preferências.
 *
 * Este ecrã ajusta a **sensibilidade** do Zemlo, e é isso que o torna delicado: os dois
 * números que aqui se mudam (antecedência em dias e em quilómetros) decidem quando o Zemlo
 * fala. Demasiado tarde e o aviso não serve para nada; demasiado cedo e o utilizador aprende
 * a ignorá-lo — que é a forma mais rápida de tornar inútil um sistema de avisos.
 *
 * Por isso cada controlo traz a explicação do que muda, e não só o rótulo. E por isso as
 * categorias frequentes existem: servem para **subir ao topo** as categorias que o utilizador
 * usa (§45), sem esconder as outras — esconder opções obriga o utilizador a adivinhar onde
 * está o que procura.
 *
 * As preferências de notificação mostram os três canais, incluindo `push` e `email`, que a
 * API aceita mas não implementa. Fica escrito o que cada um faz hoje: prometer um resumo
 * semanal por email que não sai seria vender uma funcionalidade inexistente.
 */
export function PreferencesSettingsPage() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [leadDays, setLeadDays] = useState<string | null>(null);
  const [leadKm, setLeadKm] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<boolean | null>(null);

  if (preferences.isLoading) return <LoadingBlock label="A carregar preferências…" />;
  if (preferences.isError) {
    return (
      <div className="z-page">
        <InlineError
          message={errorMessage(preferences.error)}
          requestId={errorRequestId(preferences.error)}
          onRetry={() => void preferences.refetch()}
        />
      </div>
    );
  }
  /*
   * Sem dados, sem carregamento e sem erro. Não é alcançável pelo caminho normal, e é por
   * isso que não pode devolver `null`: um ecrã em branco é indistinguível de um defeito
   * (`WEB-005`).
   */
  if (!preferences.data) {
    return (
      <div className="z-page">
        <PageHeader title="Preferências" back={{ to: '/settings', label: 'Definições' }} />
        <Card>
          <p className="z-small z-muted">
            Não conseguimos ler as tuas preferências neste momento. As tuas escolhas anteriores
            não foram alteradas — podes tentar novamente.
          </p>
          <div style={{ marginTop: 'var(--z-space-3)' }}>
            <Button variant="secondary" size="sm" onClick={() => void preferences.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const data = preferences.data;
  const effectiveLeadDays = leadDays ?? String(data.reminderLeadDays);
  const effectiveLeadKm = leadKm ?? String(data.reminderLeadKm);
  const effectiveSuggestions = suggestions ?? data.suggestionsEnabled;

  async function save(payload: Record<string, unknown>, successMessage: string) {
    setErrors({});
    try {
      await update.mutateAsync(payload as never);
      toast.show(successMessage, { variant: 'ok' });
    } catch (error) {
      const map: Record<string, string> = {};
      if (error && typeof error === 'object' && 'fields' in error) {
        for (const field of (error as { fields: Array<{ path: string; message: string }> }).fields) {
          map[field.path] = field.message;
        }
      }
      setErrors(map);
    }
  }

  function toggleCategory(code: string) {
    const current = new Set(data.frequentExpenseCategories);
    if (current.has(code)) current.delete(code);
    else current.add(code);
    void save({ frequentExpenseCategories: Array.from(current) }, 'Categorias frequentes atualizadas.');
  }

  function setNotification(topic: string, channel: string, frequency: string) {
    // A lista de preferências de notificação é substituída **inteira** (o contrato recebe um
    // array completo, não um par). Preservar as restantes entradas é o que evita que ajustar
    // o seguro apague as escolhas do IUC.
    const current = data.notifications.filter((entry) => !(entry.topic === topic && entry.channel === channel));
    const next = [...current, { topic, channel, frequency }]
      .filter((entry) => entry.frequency !== 'off')
      .map((entry) => ({ topic: entry.topic, channel: entry.channel, frequency: entry.frequency }));
    void save({ notifications: next }, 'Avisos atualizados.');
  }

  function frequencyFor(topic: string, channel: string): string {
    return data.notifications.find((entry) => entry.topic === topic && entry.channel === channel)?.frequency ?? 'off';
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Preferências"
        subtitle="Com que antecedência o Zemlo avisa e como quer ser avisado."
        back={{ to: '/settings', label: 'Definições' }}
      />

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Antecedência dos avisos</div>
            <div className="z-card__subtitle">
              Quando um prazo entra nesta margem, passa a aparecer nos cartões de estado e nas
              notificações.
            </div>
          </div>
        </div>
        <div className="z-grid z-grid--2">
          <NumberField
            label="Dias de antecedência"
            value={effectiveLeadDays}
            onChange={setLeadDays}
            min={1}
            max={180}
            hint="1 a 180 dias. Recomendamos 30: chega para pedir orçamentos sem saturar o painel."
            error={errors.reminderLeadDays}
          />
          <NumberField
            label="Quilómetros de antecedência"
            value={effectiveLeadKm}
            onChange={setLeadKm}
            min={10}
            max={20000}
            hint="10 a 20 000 km. Recomendamos 1 000 km — cerca de um mês de uso médio."
            error={errors.reminderLeadKm}
          />
        </div>
        <div className="z-row" style={{ marginTop: 'var(--z-space-4)', gap: 'var(--z-space-3)' }}>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() =>
              void save(
                {
                  reminderLeadDays: Number(effectiveLeadDays),
                  reminderLeadKm: Number(effectiveLeadKm),
                },
                'Antecedência atualizada.',
              )
            }
          >
            Guardar antecedência
          </Button>
          <span className="z-xs z-muted">
            Estes valores aplicam-se a todos os veículos da conta.
          </span>
        </div>
      </Card>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Sugestões contextuais</div>
            <div className="z-card__subtitle">
              Recomendações geradas a partir do estado real dos teus veículos
            </div>
          </div>
          <Chip tone={effectiveSuggestions ? 'ok' : 'neutral'}>
            {effectiveSuggestions ? 'Ligadas' : 'Desligadas'}
          </Chip>
        </div>
        <p className="z-small z-muted">
          Quando ligadas, o Zemlo sugere o passo seguinte quando faz sentido — por exemplo,
          guardar o seguro de um veículo que ainda não o tem. As sugestões são geradas a pedido
          e desaparecem no momento em que deixam de fazer sentido: não há uma lista acumulada de
          tarefas por cumprir.
        </p>
        <div className="z-row" style={{ marginTop: 'var(--z-space-3)', gap: 'var(--z-space-2)' }}>
          <Button
            variant={effectiveSuggestions ? 'secondary' : 'primary'}
            loading={update.isPending}
            onClick={() => {
              const next = !effectiveSuggestions;
              setSuggestions(next);
              void save({ suggestionsEnabled: next }, next ? 'Sugestões ligadas.' : 'Sugestões desligadas.');
            }}
          >
            {effectiveSuggestions ? 'Desligar sugestões' : 'Ligar sugestões'}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Categorias frequentes</div>
            <div className="z-card__subtitle">
              As que escolheres aparecem primeiro no registo rápido — nenhuma é escondida.
            </div>
          </div>
          <Chip>{formatNumber(data.frequentExpenseCategories.length, 0)} escolhidas</Chip>
        </div>
        <div className="z-option-grid">
          {EXPENSE_CATEGORIES.map((category) => {
            const selected = data.frequentExpenseCategories.includes(category.code);
            return (
              <button
                key={category.code}
                type="button"
                className="z-option"
                aria-pressed={selected}
                disabled={update.isPending}
                onClick={() => toggleCategory(category.code)}
              >
                <span className="z-option__icon" aria-hidden="true">
                  {category.icon}
                </span>
                {category.label}
              </button>
            );
          })}
        </div>
        <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
          A ordem no registo rápido é uma antecipação da tua escolha, não uma restrição: as
          catorze categorias continuam todas disponíveis.
        </p>
      </Card>

      <Section
        title="Avisos por tema e canal"
        hint="o que o Zemlo te pode contar, e por onde"
      >
        <Card flush>
          <div className="z-list">
            {NOTIFICATION_TOPICS.map((topic) => (
              <div key={topic.code} style={{ padding: 'var(--z-space-3) var(--z-space-4)', borderBottom: '1px solid var(--z-border)' }}>
                <div className="z-row z-row--between z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
                  <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
                    <span aria-hidden="true">{topic.icon}</span>
                    <span className="z-strong">{topic.label}</span>
                  </span>
                </div>
                <div className="z-grid z-grid--3" style={{ marginTop: 'var(--z-space-2)' }}>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const frequency = frequencyFor(topic.code, channel.code);
                    const unavailable = channel.code === 'push' || channel.code === 'email';
                    return (
                      <label key={channel.code} className="z-field">
                        <span className="z-field__label">
                          {channel.icon} {channel.label}
                          {unavailable ? ' (indisponível)' : ''}
                        </span>
                        <select
                          className="z-select"
                          value={frequency}
                          disabled={update.isPending}
                          onChange={(event) => setNotification(topic.code, channel.code, event.target.value)}
                          aria-label={`Frequência de ${channel.label} para ${topic.label}`}
                        >
                          <option value="off">Desligado</option>
                          {NOTIFICATION_FREQUENCIES.filter((option) => option.code !== 'off').map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                {topic.code === 'summary' ? (
                  <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-1)' }}>
                    O resumo periódico é agregado no painel e nas notificações internas.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card soft>
          <p className="z-small z-muted">
            <strong>Sobre os canais:</strong> só «No Zemlo» está implementado. As notificações
            push exigem uma aplicação móvel publicada e o email exige um servidor de correio
            configurado no servidor do Zemlo — nenhum dos dois existe nesta versão. Podes
            configurá-los já: ficam guardados e passam a funcionar quando os canais existirem.
          </p>
          <div className="z-row" style={{ marginTop: 'var(--z-space-2)', gap: 'var(--z-space-2)', flexWrap: 'wrap' }}>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <Chip key={channel.code} tone={channel.code === 'in_app' ? 'ok' : 'neutral'}>
                {channel.icon} {channel.label}
                {channel.code === 'in_app' ? ' — ativo' : ' — por implementar'}
              </Chip>
            ))}
          </div>
        </Card>
      </Section>

      {update.isError ? (
        <InlineError message={errorMessage(update.error)} requestId={errorRequestId(update.error)} />
      ) : null}

      <p className="z-xs z-muted">
        As preferências são guardadas no momento em que as mudas — não há um botão «guardar» para
        estas definições, porque um interruptor que não faz nada até se carregar noutro sítio é
        uma armadilha. A antecedência é a exceção: tem campos numéricos e um botão.{' '}
        <Link to="/settings">Voltar às definições →</Link>
      </p>
    </div>
  );
}
